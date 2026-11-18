import { OrderInquiryRepository } from '@/features/order/repositories/order-inquiry.repository';
import type { OrderStatus, PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('OrderInquiryRepository (real DB)', () => {
  let repo: OrderInquiryRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [OrderInquiryRepository],
    });
    repo = module.get(OrderInquiryRepository);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function buyer() {
    return createAccount(prisma, { account_type: 'USER' });
  }

  describe('findOrderCardSource', () => {
    it.each([
      [
        '커스텀 대표 이미지 우선',
        'https://cdn.example.com/custom.jpg',
        'https://cdn.example.com/product.jpg',
        'https://cdn.example.com/custom.jpg',
      ],
      [
        '없으면 상품 대표 이미지',
        null,
        'https://cdn.example.com/product.jpg',
        'https://cdn.example.com/product.jpg',
      ],
      ['둘 다 없으면 null', null, null, null],
    ])('썸네일: %s', async (_label, custom, product, expected) => {
      const account = await buyer();
      const store = await createStore(prisma);
      const order = await createOrder(prisma, { account_id: account.id });
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: store.id,
        product_name_snapshot: '딸기 케이크',
        custom_preview_image_url: custom,
        product_thumbnail_url_snapshot: product,
      });

      expect(
        await repo.findOrderCardSource({
          orderId: order.id,
          accountId: account.id,
        }),
      ).toEqual({
        orderId: order.id,
        orderNumber: order.order_number,
        storeId: store.id,
        productName: '딸기 케이크',
        thumbnailUrl: expected,
        pickupAt: order.pickup_at,
        submittedAt: order.submitted_at,
      });
    });

    it('삭제된 품목은 건너뛰고 남은 첫 품목을 쓴다', async () => {
      const account = await buyer();
      const order = await createOrder(prisma, { account_id: account.id });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_name_snapshot: '지운 품목',
        deleted_at: new Date(),
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_name_snapshot: '남은 품목',
      });

      const source = await repo.findOrderCardSource({
        orderId: order.id,
        accountId: account.id,
      });
      expect(source?.productName).toBe('남은 품목');
    });

    it('남의 주문·삭제된 주문·품목이 모두 지워진 주문은 null', async () => {
      const account = await buyer();
      const others = await createOrder(prisma);
      await createOrderItem(prisma, { order_id: others.id });
      const deleted = await createOrder(prisma, {
        account_id: account.id,
        deleted_at: new Date(),
      });
      await createOrderItem(prisma, { order_id: deleted.id });
      const emptied = await createOrder(prisma, { account_id: account.id });
      await createOrderItem(prisma, {
        order_id: emptied.id,
        deleted_at: new Date(),
      });

      for (const order of [others, deleted, emptied]) {
        expect(
          await repo.findOrderCardSource({
            orderId: order.id,
            accountId: account.id,
          }),
        ).toBeNull();
      }
    });
  });

  describe('existsInProgressOrderAtStore', () => {
    it.each([
      ['PENDING_PAYMENT', true],
      ['SUBMITTED', true],
      ['CONFIRMED', true],
      ['MADE', true],
      ['PICKED_UP', false],
      ['NO_SHOW', false],
      ['CANCELED', false],
    ] as [OrderStatus, boolean][])('%s 주문 → %s', async (status, expected) => {
      const account = await buyer();
      const store = await createStore(prisma);
      const order = await createOrder(prisma, {
        account_id: account.id,
        status,
      });
      await createOrderItem(prisma, { order_id: order.id, store_id: store.id });

      expect(
        await repo.existsInProgressOrderAtStore({
          accountId: account.id,
          storeId: store.id,
        }),
      ).toBe(expected);
    });

    it('다른 구매자·다른 매장·삭제된 주문·삭제된 품목은 세지 않는다', async () => {
      const account = await buyer();
      const store = await createStore(prisma);
      const elsewhere = await createStore(prisma);
      const othersOrder = await createOrder(prisma);
      await createOrderItem(prisma, {
        order_id: othersOrder.id,
        store_id: store.id,
      });
      const elsewhereOrder = await createOrder(prisma, {
        account_id: account.id,
      });
      await createOrderItem(prisma, {
        order_id: elsewhereOrder.id,
        store_id: elsewhere.id,
      });
      const deletedOrder = await createOrder(prisma, {
        account_id: account.id,
        deleted_at: new Date(),
      });
      await createOrderItem(prisma, {
        order_id: deletedOrder.id,
        store_id: store.id,
      });
      const deletedItemOrder = await createOrder(prisma, {
        account_id: account.id,
      });
      await createOrderItem(prisma, {
        order_id: deletedItemOrder.id,
        store_id: store.id,
        deleted_at: new Date(),
      });

      expect(
        await repo.existsInProgressOrderAtStore({
          accountId: account.id,
          storeId: store.id,
        }),
      ).toBe(false);
    });
  });
});
