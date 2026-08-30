import { BadRequestException } from '@nestjs/common';
import type { PrismaClient, Store } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { StoreSearchService } from '@/features/store/services/store-search.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createRegion,
  createStore,
  createStoreWishlist,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('StoreSearchService (real DB)', () => {
  let service: StoreSearchService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreSearchService,
        StoreListingService,
        StoreRepository,
        StoreWishlistRepository,
        ClockService,
      ],
    });
    service = module.get(StoreSearchService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function confirmOrders(store: Store, count: number): Promise<void> {
    const product = await createProduct(prisma, { store_id: store.id });
    for (let i = 0; i < count; i += 1) {
      const order = await createOrder(prisma, { status: 'CONFIRMED' });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
      });
    }
  }

  async function names(input: Parameters<typeof service.searchStores>[0]) {
    const result = await service.searchStores(input);
    return result.items.map((i) => i.storeName);
  }

  describe('searchStores', () => {
    it('공백 분리 단어가 매장명에 모두 포함돼야 매칭된다(AND)', async () => {
      await createStore(prisma, { store_name: '매일이 크리스마스' });
      await createStore(prisma, { store_name: '크리스마스에 눈이 올까요' });
      await createStore(prisma, { store_name: '매일 베이커리' });

      expect(await names({ keyword: '크리스마스 매일' })).toEqual([
        '매일이 크리스마스',
      ]);
      expect(await names({ keyword: '크리스마스' })).toHaveLength(2);
    });

    it('비활성·삭제 매장은 제외한다', async () => {
      await createStore(prisma, { store_name: '케이크 활성' });
      await createStore(prisma, {
        store_name: '케이크 휴업',
        is_active: false,
      });
      const deleted = await createStore(prisma, { store_name: '케이크 삭제' });
      await prisma.store.update({
        where: { id: deleted.id },
        data: { deleted_at: new Date() },
      });

      expect(await names({ keyword: '케이크' })).toEqual(['케이크 활성']);
    });

    it('regionIds 지정 시 해당 지역 매장만', async () => {
      const region = await createRegion(prisma, { level: 2, slug: 'sgg-x' });
      await createStore(prisma, {
        store_name: '케이크 지역',
        region_id: region.id,
      });
      await createStore(prisma, { store_name: '케이크 타지역' });

      expect(
        await names({ keyword: '케이크', regionIds: [region.id.toString()] }),
      ).toEqual(['케이크 지역']);
    });

    it('인기 점수순(최근 주문 많은 매장 우선)으로 정렬한다', async () => {
      const hot = await createStore(prisma, { store_name: '케이크 인기' });
      await createStore(prisma, { store_name: '케이크 보통' });
      await confirmOrders(hot, 3);

      expect(await names({ keyword: '케이크' })).toEqual([
        '케이크 인기',
        '케이크 보통',
      ]);
    });

    it('offset/limit·totalCount·hasMore', async () => {
      for (let i = 0; i < 3; i += 1) {
        await createStore(prisma, { store_name: `케이크 ${i}` });
      }

      const page = await service.searchStores({
        keyword: '케이크',
        offset: 2,
        limit: 2,
      });

      expect(page.totalCount).toBe(3);
      expect(page.items).toHaveLength(1);
      expect(page.hasMore).toBe(false);
    });

    it('카드에 로고·지역·대표 이미지(최대 4)·찜 여부를 채운다', async () => {
      const store = await createStore(prisma, {
        store_name: '케이크 하우스',
        profile_image_url: 'https://img/logo.png',
        address_city: '서울',
        address_neighborhood: '용산구',
      });
      for (let i = 0; i < 5; i += 1) {
        const product = await createProduct(prisma, { store_id: store.id });
        await prisma.productImage.create({
          data: { product_id: product.id, image_url: `https://img/${i}.png` },
        });
      }
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: store.id,
      });

      const asUser = await service.searchStores(
        { keyword: '케이크' },
        account.id,
      );
      const asGuest = await service.searchStores({ keyword: '케이크' });

      expect(asUser.items[0]).toMatchObject({
        id: store.id.toString(),
        storeName: '케이크 하우스',
        profileImageUrl: 'https://img/logo.png',
        regionLabel: '서울 용산구',
        ratingAverage: 0,
        reviewCount: 0,
        isWishlisted: true,
      });
      expect(asUser.items[0].cakeImageUrls).toHaveLength(4);
      expect(asGuest.items[0].isWishlisted).toBe(false);
    });

    it('빈 검색어는 400, 결과 없음은 빈 커넥션', async () => {
      await expect(service.searchStores({ keyword: ' ' })).rejects.toThrow(
        BadRequestException,
      );
      expect(await service.searchStores({ keyword: '없음' })).toEqual({
        items: [],
        totalCount: 0,
        hasMore: false,
      });
    });
  });

  describe('countStores', () => {
    it('목록과 동일 조건으로 센다', async () => {
      await createStore(prisma, { store_name: '케이크 A' });
      await createStore(prisma, { store_name: '케이크 B', is_active: false });

      expect(await service.countStores({ words: ['케이크'] })).toBe(1);
    });
  });
});
