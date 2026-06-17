import type { PrismaClient } from '@prisma/client';

import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createOrder,
  createOrderItem,
  createProduct,
  createRegion,
  createReview,
  createStore,
  createStoreWishlist,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('StoreListingService (real DB)', () => {
  let service: StoreListingService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [StoreListingService, StoreRepository],
    });
    service = module.get(StoreListingService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function reviewStore(storeId: bigint, rating: number): Promise<void> {
    const orderItem = await createOrderItem(prisma, { store_id: storeId });
    await createReview(prisma, { order_item_id: orderItem.id, rating });
  }

  describe('popularStores', () => {
    it('매장이 없으면 빈 커넥션과 rankedAt을 반환한다', async () => {
      const result = await service.popularStores();

      expect(result.totalCount).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.rankedAt).toBeInstanceOf(Date);
    });

    it('인기순(찜 많은 매장이 상위)으로 정렬하고 rank를 부여한다', async () => {
      const region = await createRegion(prisma, { level: 2, slug: 'sgg-rank' });
      const hot = await createStore(prisma, {
        store_name: '핫',
        region_id: region.id,
      });
      const cold = await createStore(prisma, {
        store_name: '콜드',
        region_id: region.id,
      });
      for (let i = 0; i < 3; i++) {
        await createStoreWishlist(prisma, { store_id: hot.id });
      }

      const result = await service.popularStores();

      expect(result.items.map((s) => s.storeName)).toEqual(['핫', '콜드']);
      expect(result.items[0]).toMatchObject({
        id: hot.id.toString(),
        rank: 1,
      });
      expect(result.items[1].rank).toBe(2);
      expect(cold.id.toString()).toBe(result.items[1].id);
    });

    it('지역 필터(regionIds)에 해당하는 시군구 매장만 반환한다', async () => {
      const r1 = await createRegion(prisma, { level: 2, slug: 'sgg-a' });
      const r2 = await createRegion(prisma, { level: 2, slug: 'sgg-b' });
      const target = await createStore(prisma, { region_id: r1.id });
      await createStore(prisma, { region_id: r2.id });

      const result = await service.popularStores({
        regionIds: [r1.id.toString()],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(target.id.toString());
    });

    it('평균 평점(소수 첫째)과 리뷰 수를 집계한다', async () => {
      const store = await createStore(prisma);
      await reviewStore(store.id, 4);
      await reviewStore(store.id, 5);

      const result = await service.popularStores();
      const item = result.items.find((s) => s.id === store.id.toString());

      expect(item?.ratingAverage).toBe(4.5);
      expect(item?.reviewCount).toBe(2);
    });

    it('최근 30일 유효 주문만 점수에 반영한다(오래된 주문 매장은 하위)', async () => {
      const region = await createRegion(prisma, { level: 2, slug: 'sgg-ord' });
      const recent = await createStore(prisma, {
        store_name: '최근주문',
        region_id: region.id,
      });
      const stale = await createStore(prisma, {
        store_name: '오래된주문',
        region_id: region.id,
      });

      const recentOrder = await createOrder(prisma, { status: 'CONFIRMED' });
      await createOrderItem(prisma, {
        order_id: recentOrder.id,
        store_id: recent.id,
      });

      const staleOrder = await createOrder(prisma, { status: 'CONFIRMED' });
      await createOrderItem(prisma, {
        order_id: staleOrder.id,
        store_id: stale.id,
      });
      await prisma.order.update({
        where: { id: staleOrder.id },
        data: { created_at: new Date(Date.now() - 40 * DAY_MS) },
      });

      const result = await service.popularStores();

      expect(result.items[0].storeName).toBe('최근주문');
    });

    it('대표 케이크 이미지를 매장당 최대 4장 노출한다', async () => {
      const store = await createStore(prisma);
      for (let i = 0; i < 5; i++) {
        const product = await createProduct(prisma, { store_id: store.id });
        await prisma.productImage.create({
          data: {
            product_id: product.id,
            image_url: `https://img/${product.id}.png`,
            sort_order: 0,
          },
        });
      }

      const result = await service.popularStores();
      const item = result.items.find((s) => s.id === store.id.toString());

      expect(item?.cakeImageUrls).toHaveLength(4);
    });

    it('offset/limit 페이지네이션과 hasMore를 처리한다', async () => {
      for (let i = 0; i < 3; i++) {
        await createStore(prisma, { store_name: `매장${i}` });
      }

      const result = await service.popularStores({ offset: 0, limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.totalCount).toBe(3);
      expect(result.hasMore).toBe(true);
    });

    it('비활성 매장은 제외된다', async () => {
      await createStore(prisma, { is_active: false });

      const result = await service.popularStores();

      expect(result.totalCount).toBe(0);
    });
  });
});
