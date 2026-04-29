import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { OrderRepository } from '@/features/order/repositories/order.repository';
import { UserOrderService } from '@/features/user/services/user-order.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('UserOrderService (real DB)', () => {
  let service: UserOrderService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [UserOrderService, OrderRepository],
    });
    service = module.get(UserOrderService);
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

  // ─── listMyOrders ───
  describe('listMyOrders', () => {
    it('최근 생성 순서로 주문을 반환하고 대표상품/매장/추가 아이템 수를 집계한다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma, { store_name: '매장A' });
      const p1 = await createProduct(prisma, {
        store_id: store.id,
        name: '상품1',
      });
      const p2 = await createProduct(prisma, {
        store_id: store.id,
        name: '상품2',
      });

      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: p1.id,
        product_name_snapshot: '상품1 스냅샷',
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: p2.id,
      });

      const result = await service.listMyOrders(account.id);

      expect(result.totalCount).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.items[0]).toMatchObject({
        orderId: order.id.toString(),
        representativeProductName: '상품1 스냅샷',
        storeName: '매장A',
        additionalItemCount: 1, // 첫 아이템 외 1개 더
      });
    });

    it('아이템이 없는 주문은 대표상품/매장 기본값을 반환한다', async () => {
      const account = await setupUser();
      await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });

      const result = await service.listMyOrders(account.id);

      expect(result.items[0]).toMatchObject({
        representativeProductName: '상품 정보 없음',
        representativeProductImageUrl: null,
        storeName: '매장 정보 없음',
        additionalItemCount: 0,
      });
    });

    it('status 필터를 전달하면 해당 상태의 주문만 포함한다', async () => {
      const account = await setupUser();
      await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });
      await createOrder(prisma, {
        account_id: account.id,
        status: 'PICKED_UP',
      });

      const result = await service.listMyOrders(account.id, {
        statuses: ['PICKED_UP'],
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].status).toBe('PICKED_UP');
    });

    it('limit을 초과하면 hasMore true이고 정확히 limit개만 반환한다', async () => {
      const account = await setupUser();
      for (let i = 0; i < 4; i++) {
        await createOrder(prisma, {
          account_id: account.id,
          status: 'SUBMITTED',
        });
      }

      const result = await service.listMyOrders(account.id, {
        offset: 0,
        limit: 2,
      });

      expect(result.totalCount).toBe(4);
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });

    it('다른 계정의 주문은 포함되지 않는다', async () => {
      const me = await setupUser();
      const other = await setupUser();
      await createOrder(prisma, { account_id: me.id, status: 'SUBMITTED' });
      await createOrder(prisma, {
        account_id: other.id,
        status: 'SUBMITTED',
      });

      const result = await service.listMyOrders(me.id);

      expect(result.totalCount).toBe(1);
    });

    it('offset 음수면 BadRequestException', async () => {
      const account = await setupUser();
      await expect(
        service.listMyOrders(account.id, { offset: -1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('limit이 0 이하면 BadRequestException', async () => {
      const account = await setupUser();
      await expect(
        service.listMyOrders(account.id, { limit: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('limit이 상한(50) 초과면 BadRequestException', async () => {
      const account = await setupUser();
      await expect(
        service.listMyOrders(account.id, { limit: 51 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('주문이 0건이면 빈 connection을 반환한다', async () => {
      const account = await setupUser();

      const result = await service.listMyOrders(account.id);

      expect(result.totalCount).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    // ─── hasReviewableItem ───
    describe('hasReviewableItem', () => {
      async function createPickedUpOrderWithItem(accountId: bigint) {
        const store = await createStore(prisma);
        const product = await createProduct(prisma, { store_id: store.id });
        const order = await createOrder(prisma, {
          account_id: accountId,
          status: 'PICKED_UP',
        });
        const item = await createOrderItem(prisma, {
          order_id: order.id,
          product_id: product.id,
        });
        return { store, product, order, item };
      }

      async function createReview(args: {
        orderItemId: bigint;
        accountId: bigint;
        storeId: bigint;
        productId: bigint;
        deletedAt?: Date | null;
      }) {
        return prisma.review.create({
          data: {
            order_item_id: args.orderItemId,
            account_id: args.accountId,
            store_id: args.storeId,
            product_id: args.productId,
            rating: 5,
            content: '리뷰 더미 텍스트입니다. 만족합니다.',
            deleted_at: args.deletedAt ?? null,
          },
        });
      }

      it('PICKED_UP + 리뷰 미작성 item이 1건이면 true', async () => {
        const account = await setupUser();
        await createPickedUpOrderWithItem(account.id);

        const result = await service.listMyOrders(account.id);

        expect(result.items).toHaveLength(1);
        expect(result.items[0].hasReviewableItem).toBe(true);
      });

      it('PICKED_UP + 모든 item에 active 리뷰가 있으면 false', async () => {
        const account = await setupUser();
        const { item, store, product } = await createPickedUpOrderWithItem(
          account.id,
        );
        await createReview({
          orderItemId: item.id,
          accountId: account.id,
          storeId: store.id,
          productId: product.id,
        });

        const result = await service.listMyOrders(account.id);

        expect(result.items[0].hasReviewableItem).toBe(false);
      });

      it('PICKED_UP + 모든 item의 리뷰가 soft-delete면 true', async () => {
        const account = await setupUser();
        const { item, store, product } = await createPickedUpOrderWithItem(
          account.id,
        );
        await createReview({
          orderItemId: item.id,
          accountId: account.id,
          storeId: store.id,
          productId: product.id,
          deletedAt: new Date(),
        });

        const result = await service.listMyOrders(account.id);

        expect(result.items[0].hasReviewableItem).toBe(true);
      });

      it('CONFIRMED 등 비-PICKED_UP 상태는 false', async () => {
        const account = await setupUser();
        const store = await createStore(prisma);
        const product = await createProduct(prisma, { store_id: store.id });
        const order = await createOrder(prisma, {
          account_id: account.id,
          status: 'CONFIRMED',
        });
        await createOrderItem(prisma, {
          order_id: order.id,
          product_id: product.id,
        });

        const result = await service.listMyOrders(account.id);

        expect(result.items[0].status).toBe('CONFIRMED');
        expect(result.items[0].hasReviewableItem).toBe(false);
      });

      it('CANCELED 상태는 false', async () => {
        const account = await setupUser();
        const store = await createStore(prisma);
        const product = await createProduct(prisma, { store_id: store.id });
        const order = await createOrder(prisma, {
          account_id: account.id,
          status: 'CANCELED',
        });
        await createOrderItem(prisma, {
          order_id: order.id,
          product_id: product.id,
        });

        const result = await service.listMyOrders(account.id);

        expect(result.items[0].status).toBe('CANCELED');
        expect(result.items[0].hasReviewableItem).toBe(false);
      });

      it('PICKED_UP + 일부 item에만 리뷰 미작성이면 true (혼합 케이스)', async () => {
        const account = await setupUser();
        const { item, store, product, order } =
          await createPickedUpOrderWithItem(account.id);
        // item1에는 리뷰가 있고, item2에는 없음
        await createReview({
          orderItemId: item.id,
          accountId: account.id,
          storeId: store.id,
          productId: product.id,
        });
        const product2 = await createProduct(prisma, { store_id: store.id });
        await createOrderItem(prisma, {
          order_id: order.id,
          product_id: product2.id,
        });

        const result = await service.listMyOrders(account.id);

        expect(result.items[0].hasReviewableItem).toBe(true);
      });
    });
  });

  // ─── getMyOrder ───
  describe('getMyOrder', () => {
    it('본인 주문의 상세(items/store/status) DTO를 반환한다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma, {
        store_name: '매장B',
        store_phone: '02-1234-5678',
      });
      const product = await createProduct(prisma, {
        store_id: store.id,
        name: '상품X',
        regular_price: 30000,
        sale_price: 25000,
      });
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
        quantity: 2,
        regular_price_snapshot: 30000,
        sale_price_snapshot: 25000,
      });

      const result = await service.getMyOrder(account.id, order.id);

      expect(result.orderId).toBe(order.id.toString());
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        productName: expect.any(String),
        quantity: 2,
        regularPrice: 30000,
        salePrice: 25000,
        hasMyReview: false,
        canWriteReview: false, // 상태가 SUBMITTED이므로 불가
      });
      expect(result.store).toMatchObject({
        storeName: '매장B',
        storePhone: '02-1234-5678',
      });
    });

    it('존재하지 않는 orderId면 NotFoundException', async () => {
      const account = await setupUser();
      await expect(
        service.getMyOrder(account.id, BigInt(999999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 계정의 orderId는 NotFoundException으로 접근 차단', async () => {
      const me = await setupUser();
      const other = await setupUser();
      const othersOrder = await createOrder(prisma, {
        account_id: other.id,
        status: 'SUBMITTED',
      });

      await expect(service.getMyOrder(me.id, othersOrder.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('PICKED_UP 상태면서 리뷰 미작성 아이템은 canWriteReview=true', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'PICKED_UP',
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
      });

      const result = await service.getMyOrder(account.id, order.id);

      expect(result.items[0].canWriteReview).toBe(true);
      expect(result.items[0].hasMyReview).toBe(false);
    });

    it('PICKED_UP 주문 아이템에 리뷰가 있으면 hasMyReview=true, canWriteReview=false', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'PICKED_UP',
      });
      const item = await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
      });

      await prisma.review.create({
        data: {
          order_item_id: item.id,
          account_id: account.id,
          store_id: store.id,
          product_id: product.id,
          rating: 5,
        },
      });

      const result = await service.getMyOrder(account.id, order.id);

      expect(result.items[0].hasMyReview).toBe(true);
      expect(result.items[0].canWriteReview).toBe(false);
    });

    it('아이템이 없는 주문은 store에 "매장 정보 없음" 폴백을 반환한다', async () => {
      const account = await setupUser();
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });

      const result = await service.getMyOrder(account.id, order.id);

      expect(result.items).toHaveLength(0);
      expect(result.store.storeId).toBe('0');
      expect(result.store.storeName).toBe('매장 정보 없음');
    });

    it('status_histories가 있으면 DTO에 포함되어 시간순으로 반환된다', async () => {
      const account = await setupUser();
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'CONFIRMED',
      });

      await prisma.orderStatusHistory.create({
        data: {
          order_id: order.id,
          from_status: 'SUBMITTED',
          to_status: 'CONFIRMED',
          changed_at: new Date('2026-04-15T10:00:00Z'),
          note: '접수 확정',
        },
      });

      const result = await service.getMyOrder(account.id, order.id);

      expect(result.statusHistories).toHaveLength(1);
      expect(result.statusHistories[0]).toMatchObject({
        fromStatus: 'SUBMITTED',
        toStatus: 'CONFIRMED',
        note: '접수 확정',
      });
    });
  });
});
