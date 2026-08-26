import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserWishlistService } from '@/features/user/services/user-wishlist.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrderItem,
  createProduct,
  createReview,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('UserWishlistService (real DB)', () => {
  let service: UserWishlistService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [UserWishlistService, UserRepository, ProductRepository],
    });
    service = module.get(UserWishlistService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupUser() {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    return account;
  }

  // ─── addToWishlist ───
  describe('addToWishlist', () => {
    it('처음 추가 시 wishlistItem row가 생성된다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      const result = await service.addToWishlist(
        account.id,
        product.id.toString(),
      );

      expect(result).toBe(true);
      const row = await prisma.wishlistItem.findUnique({
        where: {
          account_id_product_id: {
            account_id: account.id,
            product_id: product.id,
          },
        },
      });
      expect(row).not.toBeNull();
      expect(row?.deleted_at).toBeNull();
    });

    it('이미 active 상태로 있으면 멱등 (true 반환, 추가 row 없음)', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      await service.addToWishlist(account.id, product.id.toString());
      await service.addToWishlist(account.id, product.id.toString());

      const count = await prisma.wishlistItem.count({
        where: { account_id: account.id, product_id: product.id },
      });
      expect(count).toBe(1);
    });

    it('soft-delete된 row가 있으면 deleted_at=null로 복원된다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      await prisma.wishlistItem.create({
        data: {
          account_id: account.id,
          product_id: product.id,
          deleted_at: new Date(),
        },
      });

      await service.addToWishlist(account.id, product.id.toString());

      const row = await prisma.wishlistItem.findUnique({
        where: {
          account_id_product_id: {
            account_id: account.id,
            product_id: product.id,
          },
        },
      });
      expect(row?.deleted_at).toBeNull();
    });

    it('존재하지 않는 productId면 NotFoundException', async () => {
      const account = await setupUser();
      await expect(service.addToWishlist(account.id, '999999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('비활성 product면 NotFoundException', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, {
        store_id: store.id,
        is_active: false,
      });

      await expect(
        service.addToWishlist(account.id, product.id.toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('soft-delete된 product면 NotFoundException', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      await prisma.product.update({
        where: { id: product.id },
        data: { deleted_at: new Date() },
      });

      await expect(
        service.addToWishlist(account.id, product.id.toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('비활성 store에 속한 product면 NotFoundException', async () => {
      const account = await setupUser();
      const store = await createStore(prisma, { is_active: false });
      const product = await createProduct(prisma, { store_id: store.id });

      await expect(
        service.addToWishlist(account.id, product.id.toString()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── removeFromWishlist ───
  describe('removeFromWishlist', () => {
    it('정상 soft-delete', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      await service.addToWishlist(account.id, product.id.toString());

      const result = await service.removeFromWishlist(
        account.id,
        product.id.toString(),
      );

      expect(result).toBe(true);
      const row = await prisma.wishlistItem.findUnique({
        where: {
          account_id_product_id: {
            account_id: account.id,
            product_id: product.id,
          },
        },
      });
      expect(row?.deleted_at).not.toBeNull();
    });

    it('이미 없는 상품을 제거해도 멱등 (true 반환)', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      const result = await service.removeFromWishlist(
        account.id,
        product.id.toString(),
      );

      expect(result).toBe(true);
    });
  });

  // ─── myWishlist ───
  describe('myWishlist', () => {
    it('자기 찜만 반환 + 추가 시각 desc 정렬', async () => {
      const me = await setupUser();
      const other = await setupUser();
      const store = await createStore(prisma, { store_name: '매장A' });
      const p1 = await createProduct(prisma, {
        store_id: store.id,
        name: '상품1',
      });
      const p2 = await createProduct(prisma, {
        store_id: store.id,
        name: '상품2',
      });

      await service.addToWishlist(me.id, p1.id.toString());
      await new Promise((r) => setTimeout(r, 10));
      await service.addToWishlist(me.id, p2.id.toString());
      await service.addToWishlist(other.id, p1.id.toString());

      const result = await service.myWishlist(me.id);

      expect(result.totalCount).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].productId).toBe(p2.id.toString()); // 최근 추가가 먼저
      expect(result.items[0].productName).toBe('상품2');
      expect(result.items[0].storeName).toBe('매장A');
    });

    it('soft-delete된 wishlist 항목은 제외된다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      await service.addToWishlist(account.id, product.id.toString());
      await service.removeFromWishlist(account.id, product.id.toString());

      const result = await service.myWishlist(account.id);

      expect(result.totalCount).toBe(0);
      expect(result.items).toEqual([]);
    });

    it('비활성/삭제된 product는 제외된다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const activeProduct = await createProduct(prisma, { store_id: store.id });
      const inactiveProduct = await createProduct(prisma, {
        store_id: store.id,
      });
      const deletedProduct = await createProduct(prisma, {
        store_id: store.id,
      });

      // active 상태에서 모두 찜 추가
      await prisma.wishlistItem.createMany({
        data: [
          { account_id: account.id, product_id: activeProduct.id },
          { account_id: account.id, product_id: inactiveProduct.id },
          { account_id: account.id, product_id: deletedProduct.id },
        ],
      });
      // 이후 product 상태 변경
      await prisma.product.update({
        where: { id: inactiveProduct.id },
        data: { is_active: false },
      });
      await prisma.product.update({
        where: { id: deletedProduct.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.myWishlist(account.id);

      expect(result.totalCount).toBe(1);
      expect(result.items[0].productId).toBe(activeProduct.id.toString());
    });

    it('페이지네이션이 동작한다 (offset/limit/hasMore)', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      for (let i = 0; i < 5; i++) {
        const p = await createProduct(prisma, { store_id: store.id });
        await service.addToWishlist(account.id, p.id.toString());
      }

      const page1 = await service.myWishlist(account.id, {
        offset: 0,
        limit: 2,
      });
      expect(page1.totalCount).toBe(5);
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await service.myWishlist(account.id, {
        offset: 4,
        limit: 2,
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
    });

    // offset/limit 범위 검증은 DTO (MyWishlistInput → UserPaginationInput) 로 이전됨.

    it('카드 필드(storeId/regionLabel/discountRate/평점)를 매핑한다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma, {
        store_name: '해즈케이크',
        address_city: '서울',
        address_neighborhood: '대치동',
      });
      const product = await createProduct(prisma, {
        store_id: store.id,
        regular_price: 40000,
        sale_price: 26000,
      });
      const oi1 = await createOrderItem(prisma, { product_id: product.id });
      const oi2 = await createOrderItem(prisma, { product_id: product.id });
      await createReview(prisma, { order_item_id: oi1.id, rating: 4.5 });
      await createReview(prisma, { order_item_id: oi2.id, rating: 5 });
      await service.addToWishlist(account.id, product.id.toString());

      const result = await service.myWishlist(account.id);

      const item = result.items[0];
      expect(item.storeId).toBe(store.id.toString());
      expect(item.regionLabel).toBe('서울 대치동');
      // (40000 - 26000) / 40000 = 35%
      expect(item.discountRate).toBe(35);
      // (4.5 + 5.0) / 2 = 4.75 → 4.8
      expect(item.ratingAverage).toBe(4.8);
      expect(item.reviewCount).toBe(2);
    });

    it('리뷰 없는 상품의 평점은 0.0/0건이다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, {
        store_id: store.id,
        sale_price: null,
      });
      await service.addToWishlist(account.id, product.id.toString());

      const result = await service.myWishlist(account.id);

      expect(result.items[0].ratingAverage).toBe(0);
      expect(result.items[0].reviewCount).toBe(0);
      expect(result.items[0].discountRate).toBe(0);
    });

    it('storeId 필터로 해당 매장 찜 상품만 반환한다', async () => {
      const account = await setupUser();
      const storeA = await createStore(prisma);
      const storeB = await createStore(prisma);
      const pA = await createProduct(prisma, { store_id: storeA.id });
      const pB = await createProduct(prisma, { store_id: storeB.id });
      await service.addToWishlist(account.id, pA.id.toString());
      await service.addToWishlist(account.id, pB.id.toString());

      const result = await service.myWishlist(account.id, {
        storeId: storeA.id.toString(),
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].productId).toBe(pA.id.toString());
      expect(result.items[0].storeId).toBe(storeA.id.toString());
    });
  });

  // ─── myWishlistStoreGroups ───
  describe('myWishlistStoreGroups', () => {
    it('매장별 찜 상품 수를 집계하고 찜 수 desc로 정렬한다', async () => {
      const account = await setupUser();
      const storeA = await createStore(prisma, {
        store_name: '해즈 케이크',
        profile_image_url: 'https://cdn.example.com/haz.png',
      });
      const storeB = await createStore(prisma, { store_name: '달콤 케이크' });
      // A에 2개, B에 1개 찜 — A는 먼저 찜해도 개수 우선으로 앞에 온다
      for (let i = 0; i < 2; i++) {
        const p = await createProduct(prisma, { store_id: storeA.id });
        await service.addToWishlist(account.id, p.id.toString());
      }
      const pB = await createProduct(prisma, { store_id: storeB.id });
      await service.addToWishlist(account.id, pB.id.toString());

      const result = await service.myWishlistStoreGroups(account.id);

      expect(result.totalCount).toBe(2);
      expect(result.items).toEqual([
        {
          storeId: storeA.id.toString(),
          storeName: '해즈 케이크',
          profileImageUrl: 'https://cdn.example.com/haz.png',
          wishlistedProductCount: 2,
        },
        {
          storeId: storeB.id.toString(),
          storeName: '달콤 케이크',
          profileImageUrl: null,
          wishlistedProductCount: 1,
        },
      ]);
    });

    it('찜 수 동점이면 최근 찜한 매장이 먼저 온다', async () => {
      const account = await setupUser();
      const storeA = await createStore(prisma);
      const storeB = await createStore(prisma);
      const pA = await createProduct(prisma, { store_id: storeA.id });
      const pB = await createProduct(prisma, { store_id: storeB.id });
      await service.addToWishlist(account.id, pA.id.toString());
      await new Promise((r) => setTimeout(r, 10));
      await service.addToWishlist(account.id, pB.id.toString());

      const result = await service.myWishlistStoreGroups(account.id);

      expect(result.items.map((i) => i.storeId)).toEqual([
        storeB.id.toString(),
        storeA.id.toString(),
      ]);
    });

    it('가시성은 myWishlist와 일치한다(비활성 상품·매장/soft-delete 찜 제외)', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const visible = await createProduct(prisma, { store_id: store.id });
      const inactivated = await createProduct(prisma, { store_id: store.id });
      const removed = await createProduct(prisma, { store_id: store.id });
      const inactiveStore = await createStore(prisma);
      const orphan = await createProduct(prisma, {
        store_id: inactiveStore.id,
      });
      await service.addToWishlist(account.id, visible.id.toString());
      await service.addToWishlist(account.id, inactivated.id.toString());
      await service.addToWishlist(account.id, removed.id.toString());
      await service.addToWishlist(account.id, orphan.id.toString());
      await prisma.product.update({
        where: { id: inactivated.id },
        data: { is_active: false },
      });
      await service.removeFromWishlist(account.id, removed.id.toString());
      await prisma.store.update({
        where: { id: inactiveStore.id },
        data: { is_active: false },
      });

      const groups = await service.myWishlistStoreGroups(account.id);
      const list = await service.myWishlist(account.id);

      expect(groups.totalCount).toBe(1);
      expect(groups.items[0].wishlistedProductCount).toBe(1);
      // 그룹 카운트 합 == 상품 찜 목록 totalCount (화면 01·02 카운트 일관성)
      const groupSum = groups.items.reduce(
        (sum, g) => sum + g.wishlistedProductCount,
        0,
      );
      expect(groupSum).toBe(list.totalCount);
    });

    it('offset/limit 페이지네이션과 hasMore를 계산한다', async () => {
      const account = await setupUser();
      for (let i = 0; i < 3; i++) {
        const store = await createStore(prisma);
        const p = await createProduct(prisma, { store_id: store.id });
        await service.addToWishlist(account.id, p.id.toString());
      }

      const page1 = await service.myWishlistStoreGroups(account.id, {
        offset: 0,
        limit: 2,
      });
      const page2 = await service.myWishlistStoreGroups(account.id, {
        offset: 2,
        limit: 2,
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.totalCount).toBe(3);
      expect(page1.hasMore).toBe(true);
      expect(page2.items).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
    });

    it('찜이 없으면 빈 목록을 반환한다', async () => {
      const account = await setupUser();

      const result = await service.myWishlistStoreGroups(account.id);

      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.hasMore).toBe(false);
    });
  });
});
