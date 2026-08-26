import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreWishlistService } from '@/features/store/services/store-wishlist.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrderItem,
  createReview,
  createStore,
  createStoreWishlist,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('StoreWishlistService (real DB)', () => {
  let service: StoreWishlistService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreWishlistService,
        StoreWishlistRepository,
        StoreRepository,
      ],
    });
    service = module.get(StoreWishlistService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function activeWishlistCount(
    accountId: bigint,
    storeId: bigint,
  ): Promise<number> {
    return prisma.storeWishlistItem.count({
      where: { account_id: accountId, store_id: storeId, deleted_at: null },
    });
  }

  describe('addStoreToWishlist', () => {
    it('매장을 찜한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);

      const ok = await service.addStoreToWishlist(
        account.id,
        store.id.toString(),
      );

      expect(ok).toBe(true);
      expect(await activeWishlistCount(account.id, store.id)).toBe(1);
    });

    it('중복 추가는 멱등하다(1건 유지)', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);

      await service.addStoreToWishlist(account.id, store.id.toString());
      await service.addStoreToWishlist(account.id, store.id.toString());

      expect(await activeWishlistCount(account.id, store.id)).toBe(1);
    });

    it('soft-delete된 찜은 복원한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: store.id,
        deleted_at: new Date(),
      });

      await service.addStoreToWishlist(account.id, store.id.toString());

      expect(await activeWishlistCount(account.id, store.id)).toBe(1);
    });

    it('존재하지 않는 매장이면 NotFoundException', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        service.addStoreToWishlist(account.id, '999999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('비활성 매장이면 NotFoundException', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const inactive = await createStore(prisma, { is_active: false });
      await expect(
        service.addStoreToWishlist(account.id, inactive.id.toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('유효하지 않은 storeId면 BadRequestException', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        service.addStoreToWishlist(account.id, 'not-a-number'),
      ).rejects.toThrow(BadRequestException);
    });

    it('USER가 아닌 계정(SELLER)은 찜할 수 없다(Forbidden)', async () => {
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      const store = await createStore(prisma);
      await expect(
        service.addStoreToWishlist(seller.id, store.id.toString()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('myWishlistedStores', () => {
    async function addImages(storeId: bigint, urls: string[]): Promise<void> {
      await prisma.storeImage.createMany({
        data: urls.map((url, index) => ({
          store_id: storeId,
          image_url: url,
          sort_order: index,
        })),
      });
    }

    it('찜한 매장 목록을 찜 최신순으로 반환한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const storeA = await createStore(prisma, {
        store_name: '해즈케이크',
        profile_image_url: 'https://cdn.example.com/haz-logo.png',
        address_city: '인천',
        address_neighborhood: '청라동',
      });
      const storeB = await createStore(prisma, { store_name: '달달케이크' });
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: storeA.id,
      });
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: storeB.id,
      });

      const result = await service.myWishlistedStores(account.id);

      expect(result.totalCount).toBe(2);
      expect(result.hasMore).toBe(false);
      // 나중에 찜한 storeB가 먼저(최신순)
      expect(result.items.map((i) => i.storeId)).toEqual([
        storeB.id.toString(),
        storeA.id.toString(),
      ]);
      const haz = result.items[1];
      expect(haz.storeName).toBe('해즈케이크');
      expect(haz.profileImageUrl).toBe('https://cdn.example.com/haz-logo.png');
      expect(haz.regionLabel).toBe('인천 청라동');
      expect(haz.addedAt).toBeInstanceOf(Date);
    });

    it('대표 이미지는 sort_order asc 최대 3장, 삭제된 이미지는 제외한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);
      await addImages(store.id, ['u0', 'u1', 'u2', 'u3']);
      await prisma.storeImage.updateMany({
        where: { store_id: store.id, image_url: 'u1' },
        data: { deleted_at: new Date() },
      });
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: store.id,
      });

      const result = await service.myWishlistedStores(account.id);

      expect(result.items[0].imageUrls).toEqual(['u0', 'u2', 'u3']);
    });

    it('평점은 소수 첫째 자리 반올림, 리뷰 없으면 0.0/0건이다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const rated = await createStore(prisma);
      const unrated = await createStore(prisma);
      const oi1 = await createOrderItem(prisma, { store_id: rated.id });
      const oi2 = await createOrderItem(prisma, { store_id: rated.id });
      await createReview(prisma, { order_item_id: oi1.id, rating: 4.5 });
      await createReview(prisma, { order_item_id: oi2.id, rating: 5 });
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: rated.id,
      });
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: unrated.id,
      });

      const result = await service.myWishlistedStores(account.id);

      const ratedItem = result.items.find(
        (i) => i.storeId === rated.id.toString(),
      );
      const unratedItem = result.items.find(
        (i) => i.storeId === unrated.id.toString(),
      );
      // (4.5 + 5.0) / 2 = 4.75 → 4.8
      expect(ratedItem?.ratingAverage).toBe(4.8);
      expect(ratedItem?.reviewCount).toBe(2);
      expect(unratedItem?.ratingAverage).toBe(0);
      expect(unratedItem?.reviewCount).toBe(0);
    });

    it('비활성·삭제 매장과 soft-delete된 찜은 목록·카운트에서 제외한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const active = await createStore(prisma);
      const inactive = await createStore(prisma, { is_active: false });
      const deleted = await createStore(prisma);
      await prisma.store.update({
        where: { id: deleted.id },
        data: { deleted_at: new Date() },
      });
      const removedWish = await createStore(prisma);
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: active.id,
      });
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: inactive.id,
      });
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: deleted.id,
      });
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: removedWish.id,
        deleted_at: new Date(),
      });

      const result = await service.myWishlistedStores(account.id);

      expect(result.totalCount).toBe(1);
      expect(result.items.map((i) => i.storeId)).toEqual([
        active.id.toString(),
      ]);
    });

    it('재찜(복원)한 매장은 목록 최상단으로 온다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const first = await createStore(prisma);
      const second = await createStore(prisma);
      await service.addStoreToWishlist(account.id, first.id.toString());
      await new Promise((r) => setTimeout(r, 10));
      await service.addStoreToWishlist(account.id, second.id.toString());
      // first를 해제 후 재찜 → 재찜 시점 기준으로 second보다 앞서야 한다
      await service.removeStoreFromWishlist(account.id, first.id.toString());
      await new Promise((r) => setTimeout(r, 10));
      await service.addStoreToWishlist(account.id, first.id.toString());

      const result = await service.myWishlistedStores(account.id);

      expect(result.items.map((i) => i.storeId)).toEqual([
        first.id.toString(),
        second.id.toString(),
      ]);
    });

    it('다른 사용자의 찜은 포함하지 않는다', async () => {
      const me = await createAccount(prisma, { account_type: 'USER' });
      const other = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);
      await createStoreWishlist(prisma, {
        account_id: other.id,
        store_id: store.id,
      });

      const result = await service.myWishlistedStores(me.id);

      expect(result.totalCount).toBe(0);
      expect(result.items).toEqual([]);
    });

    it('offset/limit 페이지네이션과 hasMore를 계산한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const stores = [];
      for (let i = 0; i < 3; i += 1) {
        const store = await createStore(prisma);
        await createStoreWishlist(prisma, {
          account_id: account.id,
          store_id: store.id,
        });
        stores.push(store);
      }

      const page1 = await service.myWishlistedStores(account.id, {
        offset: 0,
        limit: 2,
      });
      const page2 = await service.myWishlistedStores(account.id, {
        offset: 2,
        limit: 2,
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.totalCount).toBe(3);
      expect(page1.hasMore).toBe(true);
      expect(page2.items).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
      // 페이지를 이어 붙이면 최신순 전체와 일치(경계 중복/누락 없음)
      expect([...page1.items, ...page2.items].map((i) => i.storeId)).toEqual(
        stores.map((s) => s.id.toString()).reverse(),
      );
    });
  });

  describe('removeStoreFromWishlist', () => {
    it('찜을 해제한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: store.id,
      });

      const ok = await service.removeStoreFromWishlist(
        account.id,
        store.id.toString(),
      );

      expect(ok).toBe(true);
      expect(await activeWishlistCount(account.id, store.id)).toBe(0);
    });

    it('찜이 없어도 멱등하게 true를 반환한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);

      const ok = await service.removeStoreFromWishlist(
        account.id,
        store.id.toString(),
      );

      expect(ok).toBe(true);
    });
  });
});
