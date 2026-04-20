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

    it('counts는 active 레코드만 계산한다 (타 계정 리뷰는 카운트 제외)', async () => {
      const account = await setupUser();
      const product = await createProduct(prisma);

      // Custom drafts: 2 active (IN_PROGRESS, READY_FOR_ORDER) — 카운트 대상
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
          product_id: product.id,
          status: 'READY_FOR_ORDER',
        },
      });

      // 위시리스트 2개
      await prisma.wishlistItem.create({
        data: { account_id: account.id, product_id: product.id },
      });
      const product2 = await createProduct(prisma);
      await prisma.wishlistItem.create({
        data: { account_id: account.id, product_id: product2.id },
      });

      // 다른 계정 리뷰 — 내 리뷰 카운트에 포함되면 안 됨
      await createReview(prisma);

      const result = await service.getOverview(account.id);

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
      });
    });
  });
});
