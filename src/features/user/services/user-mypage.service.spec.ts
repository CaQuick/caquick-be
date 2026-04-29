import type { PrismaClient } from '@prisma/client';
import { OrderStatus } from '@prisma/client';

import { OrderRepository } from '@/features/order/repositories/order.repository';
import { RecentProductViewRepository } from '@/features/user/repositories/recent-product-view.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserMypageService } from '@/features/user/services/user-mypage.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createRecentProductView,
  createReview,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('UserMypageService (real DB)', () => {
  let service: UserMypageService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserMypageService,
        UserRepository,
        OrderRepository,
        RecentProductViewRepository,
      ],
    });
    service = module.get(UserMypageService);
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

  describe('getOverview', () => {
    it('데이터가 전혀 없으면 counts는 0, 목록들은 빈 배열로 반환한다', async () => {
      const account = await setupUser();

      const result = await service.getOverview(account.id);

      expect(result.counts).toEqual({
        customDraftCount: 0,
        couponCount: 0,
        wishlistCount: 0,
        myReviewCount: 0,
      });
      expect(result.ongoingOrders).toEqual([]);
      expect(result.recentViewedProducts).toEqual([]);
    });

    it('counts는 active 레코드만 계산한다 (soft-delete + 타계정 제외)', async () => {
      const account = await setupUser();
      const product = await createProduct(prisma);
      const product2 = await createProduct(prisma);
      const product3 = await createProduct(prisma);

      // Custom drafts: active 2 + soft-deleted 1
      await prisma.customDraft.create({
        data: {
          account_id: account.id,
          product_id: product.id,
          status: 'IN_PROGRESS',
        },
      });
      await prisma.customDraft.create({
        data: {
          account_id: account.id,
          product_id: product2.id,
          status: 'READY_FOR_ORDER',
        },
      });
      await prisma.customDraft.create({
        data: {
          account_id: account.id,
          product_id: product3.id,
          status: 'IN_PROGRESS',
          deleted_at: new Date(),
        },
      });

      // 위시리스트: active 2 + soft-deleted 1 → soft-delete middleware가 제외해야 함
      await prisma.wishlistItem.create({
        data: { account_id: account.id, product_id: product.id },
      });
      await prisma.wishlistItem.create({
        data: { account_id: account.id, product_id: product2.id },
      });
      await prisma.wishlistItem.create({
        data: {
          account_id: account.id,
          product_id: product3.id,
          deleted_at: new Date(),
        },
      });

      // 리뷰: 타계정 것 1 + 본인 soft-deleted 1 → 둘 다 myReviewCount=0이어야 함
      await createReview(prisma);

      const myOrder = await createOrder(prisma, {
        account_id: account.id,
        status: 'PICKED_UP',
      });
      const myOrderItem = await createOrderItem(prisma, {
        order_id: myOrder.id,
        product_id: product.id,
      });
      await prisma.review.create({
        data: {
          order_item_id: myOrderItem.id,
          account_id: account.id,
          store_id: myOrderItem.store_id,
          product_id: myOrderItem.product_id,
          rating: 5,
          deleted_at: new Date(),
        },
      });

      const result = await service.getOverview(account.id);

      // 정확히 active 레코드만 카운트
      expect(result.counts.customDraftCount).toBe(2);
      expect(result.counts.wishlistCount).toBe(2);
      expect(result.counts.myReviewCount).toBe(0);
    });

    it('진행중 주문은 SUBMITTED/CONFIRMED/MADE 상태만, 90일 내로 필터한다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      // 진행중: SUBMITTED
      const active1 = await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });
      await createOrderItem(prisma, {
        order_id: active1.id,
        product_id: product.id,
        product_name_snapshot: '대표상품A',
      });

      // 완료(PICKED_UP) 상태 → 진행중에서 제외
      const completed = await createOrder(prisma, {
        account_id: account.id,
        status: 'PICKED_UP',
      });
      await createOrderItem(prisma, {
        order_id: completed.id,
        product_id: product.id,
      });

      // 90일 초과 → 제외
      const oldOrder = await prisma.order.create({
        data: {
          account_id: account.id,
          order_number: 'OLD-1',
          status: OrderStatus.SUBMITTED,
          pickup_at: new Date(),
          buyer_name: 'buyer',
          buyer_phone: '010-0000-0000',
          subtotal_price: 0,
          discount_price: 0,
          total_price: 0,
          created_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
        },
      });
      await createOrderItem(prisma, {
        order_id: oldOrder.id,
        product_id: product.id,
      });

      const result = await service.getOverview(account.id);

      expect(result.ongoingOrders).toHaveLength(1);
      expect(result.ongoingOrders[0].orderId).toBe(active1.id.toString());
      expect(result.ongoingOrders[0].status).toBe('SUBMITTED');
      expect(result.ongoingOrders[0].representativeProductName).toBe(
        '대표상품A',
      );
    });

    it('진행중 주문의 첫 아이템이 없으면 대표상품을 "상품 정보 없음"으로 폴백한다', async () => {
      const account = await setupUser();
      await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });

      const result = await service.getOverview(account.id);

      expect(result.ongoingOrders).toHaveLength(1);
      expect(result.ongoingOrders[0].representativeProductName).toBe(
        '상품 정보 없음',
      );
      expect(result.ongoingOrders[0].representativeProductImageUrl).toBeNull();
    });

    it('recentViewedProducts를 DTO 변환된 형태로 반환한다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma, { store_name: '케이크샵' });
      const product = await createProduct(prisma, {
        store_id: store.id,
        name: '레터링 케이크',
        regular_price: 40000,
        sale_price: 35000,
      });
      await createRecentProductView(prisma, {
        account_id: account.id,
        product_id: product.id,
      });

      const result = await service.getOverview(account.id);

      expect(result.recentViewedProducts).toHaveLength(1);
      expect(result.recentViewedProducts[0]).toMatchObject({
        productId: product.id.toString(),
        productName: '레터링 케이크',
        storeName: '케이크샵',
        regularPrice: 40000,
        salePrice: 35000,
        isWishlisted: false,
      });
    });

    it('wishlistCount는 비활성/삭제 product가 연결된 wishlist는 제외한다 (myWishlist 가시성과 일치)', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const visibleProduct = await createProduct(prisma, {
        store_id: store.id,
      });
      const inactiveProduct = await createProduct(prisma, {
        store_id: store.id,
      });
      const deletedProduct = await createProduct(prisma, {
        store_id: store.id,
      });
      const inactiveStore = await createStore(prisma);
      const productOfInactiveStore = await createProduct(prisma, {
        store_id: inactiveStore.id,
      });

      // 4개 모두 active 상태에서 찜 추가
      await prisma.wishlistItem.createMany({
        data: [
          { account_id: account.id, product_id: visibleProduct.id },
          { account_id: account.id, product_id: inactiveProduct.id },
          { account_id: account.id, product_id: deletedProduct.id },
          { account_id: account.id, product_id: productOfInactiveStore.id },
        ],
      });
      // 이후 상태 변경 (3개는 invisible로 만든다)
      await prisma.product.update({
        where: { id: inactiveProduct.id },
        data: { is_active: false },
      });
      await prisma.product.update({
        where: { id: deletedProduct.id },
        data: { deleted_at: new Date() },
      });
      await prisma.store.update({
        where: { id: inactiveStore.id },
        data: { is_active: false },
      });

      const result = await service.getOverview(account.id);

      expect(result.counts.wishlistCount).toBe(1);
    });

    it('recentViewedProducts에 찜한 상품은 isWishlisted=true로 매핑된다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const wishlisted = await createProduct(prisma, { store_id: store.id });
      const notWishlisted = await createProduct(prisma, { store_id: store.id });
      await createRecentProductView(prisma, {
        account_id: account.id,
        product_id: wishlisted.id,
      });
      await createRecentProductView(prisma, {
        account_id: account.id,
        product_id: notWishlisted.id,
      });
      await prisma.wishlistItem.create({
        data: { account_id: account.id, product_id: wishlisted.id },
      });
      // 다른 계정 찜 + 본인 soft-delete 찜은 isWishlisted에 영향 안 줌
      const other = await setupUser();
      await prisma.wishlistItem.create({
        data: { account_id: other.id, product_id: notWishlisted.id },
      });

      const result = await service.getOverview(account.id);

      const map = new Map(
        result.recentViewedProducts.map((p) => [p.productId, p.isWishlisted]),
      );
      expect(map.get(wishlisted.id.toString())).toBe(true);
      expect(map.get(notWishlisted.id.toString())).toBe(false);
    });
  });
});
