import type { PrismaClient } from '@prisma/client';
import { OrderStatus } from '@prisma/client';

import { OrderRepository } from '@/features/order/repositories/order.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('OrderRepository (real DB)', () => {
  let repo: OrderRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [OrderRepository],
    });
    repo = module.get(OrderRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupBuyer() {
    return createAccount(prisma, { account_type: 'USER' });
  }

  describe('findOngoingOrdersByAccount', () => {
    it('SUBMITTED/CONFIRMED/MADE 상태 주문만 since 이후로 반환하고 PICKED_UP/CANCELED 제외', async () => {
      const buyer = await setupBuyer();
      const since = new Date('2026-01-01');

      const o1 = await createOrder(prisma, {
        account_id: buyer.id,
        status: 'SUBMITTED',
      });
      await createOrder(prisma, {
        account_id: buyer.id,
        status: 'PICKED_UP',
      });
      await createOrder(prisma, {
        account_id: buyer.id,
        status: 'CANCELED',
      });
      const o4 = await createOrder(prisma, {
        account_id: buyer.id,
        status: 'CONFIRMED',
      });

      const rows = await repo.findOngoingOrdersByAccount({
        accountId: buyer.id,
        since,
        limit: 10,
      });
      expect(rows.map((r) => r.id).sort()).toEqual([o1.id, o4.id].sort());
    });

    it('since 이전에 생성된 주문은 제외한다', async () => {
      const buyer = await setupBuyer();
      const oldOrder = await prisma.order.create({
        data: {
          account_id: buyer.id,
          order_number: 'OLD-1',
          status: 'SUBMITTED',
          pickup_at: new Date(),
          buyer_name: 'x',
          buyer_phone: '010-0000-0000',
          subtotal_price: 0,
          discount_price: 0,
          total_price: 0,
          created_at: new Date('2025-01-01'),
        },
      });
      await createOrder(prisma, { account_id: buyer.id, status: 'SUBMITTED' });

      const rows = await repo.findOngoingOrdersByAccount({
        accountId: buyer.id,
        since: new Date('2026-01-01'),
        limit: 10,
      });
      expect(rows.map((r) => r.id)).not.toContain(oldOrder.id);
    });

    it('첫 item + 첫 image까지 포함하여 반환', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      await prisma.productImage.create({
        data: {
          product_id: product.id,
          image_url: 'https://i.example/1.png',
          sort_order: 0,
        },
      });
      const order = await createOrder(prisma, {
        account_id: buyer.id,
        status: 'SUBMITTED',
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
        product_name_snapshot: '케이크',
      });

      const rows = await repo.findOngoingOrdersByAccount({
        accountId: buyer.id,
        since: new Date('2026-01-01'),
        limit: 10,
      });
      expect(rows[0].items).toHaveLength(1);
      expect(rows[0].items[0].product_name_snapshot).toBe('케이크');
      expect(rows[0].items[0].product.images).toHaveLength(1);
    });
  });

  describe('findOrdersByAccount / countOrdersByAccount', () => {
    it('statuses 필터 + offset/limit + 내림차순', async () => {
      const buyer = await setupBuyer();
      for (let i = 0; i < 4; i++) {
        await createOrder(prisma, {
          account_id: buyer.id,
          status: i % 2 === 0 ? 'SUBMITTED' : 'PICKED_UP',
        });
      }

      const count = await repo.countOrdersByAccount({
        accountId: buyer.id,
        statuses: [OrderStatus.SUBMITTED],
      });
      expect(count).toBe(2);

      const rows = await repo.findOrdersByAccount({
        accountId: buyer.id,
        statuses: [OrderStatus.SUBMITTED],
        offset: 0,
        limit: 10,
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === 'SUBMITTED')).toBe(true);
    });

    it('statuses 없으면 전체 반환', async () => {
      const buyer = await setupBuyer();
      for (let i = 0; i < 3; i++)
        await createOrder(prisma, { account_id: buyer.id });

      const count = await repo.countOrdersByAccount({ accountId: buyer.id });
      expect(count).toBe(3);
    });

    it('_count.items는 soft-deleted item을 제외한다', async () => {
      const buyer = await setupBuyer();
      const order = await createOrder(prisma, { account_id: buyer.id });
      await createOrderItem(prisma, { order_id: order.id });
      const deletedItem = await createOrderItem(prisma, { order_id: order.id });
      await prisma.orderItem.update({
        where: { id: deletedItem.id },
        data: { deleted_at: new Date() },
      });

      const rows = await repo.findOrdersByAccount({
        accountId: buyer.id,
        offset: 0,
        limit: 10,
      });
      expect(rows[0]._count.items).toBe(1);
    });
  });

  describe('findOrderDetailByAccount', () => {
    it('본인 주문이면 상세 반환 (status_histories 포함)', async () => {
      const buyer = await setupBuyer();
      const order = await createOrder(prisma, {
        account_id: buyer.id,
        status: 'CONFIRMED',
      });
      await prisma.orderStatusHistory.create({
        data: {
          order_id: order.id,
          from_status: 'SUBMITTED',
          to_status: 'CONFIRMED',
          changed_at: new Date(),
          note: '확정',
        },
      });

      const detail = await repo.findOrderDetailByAccount({
        orderId: order.id,
        accountId: buyer.id,
      });
      expect(detail?.id).toBe(order.id);
      expect(detail?.status_histories).toHaveLength(1);
    });

    it('다른 계정 주문은 null', async () => {
      const me = await setupBuyer();
      const other = await setupBuyer();
      const othersOrder = await createOrder(prisma, { account_id: other.id });

      const detail = await repo.findOrderDetailByAccount({
        orderId: othersOrder.id,
        accountId: me.id,
      });
      expect(detail).toBeNull();
    });
  });

  describe('listOrdersByStore', () => {
    it('해당 store item을 포함한 주문만 반환', async () => {
      const storeA = await createStore(prisma);
      const storeB = await createStore(prisma);
      const buyer = await setupBuyer();

      const orderA = await createOrder(prisma, { account_id: buyer.id });
      await createOrderItem(prisma, {
        order_id: orderA.id,
        store_id: storeA.id,
      });

      const orderB = await createOrder(prisma, { account_id: buyer.id });
      await createOrderItem(prisma, {
        order_id: orderB.id,
        store_id: storeB.id,
      });

      const rows = await repo.listOrdersByStore({
        storeId: storeA.id,
        limit: 10,
      });
      expect(rows.map((r) => r.id)).toEqual([orderA.id]);
    });

    it('search는 order_number/buyer_name/buyer_phone 에서 contains 매칭', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const o1 = await createOrder(prisma, {
        account_id: buyer.id,
        order_number: 'ORD-ABC-1',
        buyer_name: '홍길동',
      });
      await createOrderItem(prisma, { order_id: o1.id, store_id: store.id });
      const o2 = await createOrder(prisma, {
        account_id: buyer.id,
        order_number: 'ORD-XYZ-2',
        buyer_name: '김철수',
      });
      await createOrderItem(prisma, { order_id: o2.id, store_id: store.id });

      const rows = await repo.listOrdersByStore({
        storeId: store.id,
        limit: 10,
        search: 'ABC',
      });
      expect(rows.map((r) => r.id)).toEqual([o1.id]);

      const byBuyer = await repo.listOrdersByStore({
        storeId: store.id,
        limit: 10,
        search: '김철수',
      });
      expect(byBuyer.map((r) => r.id)).toEqual([o2.id]);
    });

    it('fromCreatedAt/toCreatedAt/status 필터가 조합된다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const inside = await createOrder(prisma, {
        account_id: buyer.id,
        status: 'SUBMITTED',
      });
      await createOrderItem(prisma, {
        order_id: inside.id,
        store_id: store.id,
      });

      const outside = await prisma.order.create({
        data: {
          account_id: buyer.id,
          order_number: 'OLD-1',
          status: 'SUBMITTED',
          pickup_at: new Date(),
          buyer_name: 'x',
          buyer_phone: '010-0000-0000',
          subtotal_price: 0,
          discount_price: 0,
          total_price: 0,
          created_at: new Date('2025-01-01'),
        },
      });
      await createOrderItem(prisma, {
        order_id: outside.id,
        store_id: store.id,
      });

      const rows = await repo.listOrdersByStore({
        storeId: store.id,
        limit: 10,
        status: OrderStatus.SUBMITTED,
        fromCreatedAt: new Date('2026-01-01'),
      });
      expect(rows.map((r) => r.id)).toEqual([inside.id]);
    });

    it('cursor 기반 페이지네이션 (id < cursor)', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const o1 = await createOrder(prisma, { account_id: buyer.id });
      await createOrderItem(prisma, { order_id: o1.id, store_id: store.id });
      const o2 = await createOrder(prisma, { account_id: buyer.id });
      await createOrderItem(prisma, { order_id: o2.id, store_id: store.id });

      const rows = await repo.listOrdersByStore({
        storeId: store.id,
        limit: 10,
        cursor: o2.id,
      });
      expect(rows.map((r) => r.id)).toEqual([o1.id]);
    });
  });

  describe('findOrderDetailByStore', () => {
    it('해당 store item만 items로 포함 (다른 store item 제외)', async () => {
      const storeA = await createStore(prisma);
      const storeB = await createStore(prisma);
      const buyer = await setupBuyer();
      const order = await createOrder(prisma, { account_id: buyer.id });
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: storeA.id,
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: storeB.id,
      });

      const detail = await repo.findOrderDetailByStore({
        orderId: order.id,
        storeId: storeA.id,
      });
      expect(detail?.items).toHaveLength(1);
      expect(detail?.items[0].store_id).toBe(storeA.id);
    });

    it('해당 store item이 없는 주문이면 null', async () => {
      const storeA = await createStore(prisma);
      const storeB = await createStore(prisma);
      const buyer = await setupBuyer();
      const order = await createOrder(prisma, { account_id: buyer.id });
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: storeB.id,
      });

      const detail = await repo.findOrderDetailByStore({
        orderId: order.id,
        storeId: storeA.id,
      });
      expect(detail).toBeNull();
    });
  });

  describe('updateOrderStatusBySeller', () => {
    async function setupOrderForStore(storeId: bigint, buyerId: bigint) {
      const order = await createOrder(prisma, {
        account_id: buyerId,
        status: 'SUBMITTED',
      });
      await createOrderItem(prisma, { order_id: order.id, store_id: storeId });
      return order;
    }

    it('다른 store의 주문이면 null 반환 (update 미수행)', async () => {
      const storeA = await createStore(prisma);
      const storeB = await createStore(prisma);
      const buyer = await setupBuyer();
      const order = await setupOrderForStore(storeA.id, buyer.id);
      const seller = await createAccount(prisma, { account_type: 'SELLER' });

      const result = await repo.updateOrderStatusBySeller({
        orderId: order.id,
        storeId: storeB.id,
        actorAccountId: seller.id,
        toStatus: OrderStatus.CONFIRMED,
        note: null,
        now: new Date(),
      });
      expect(result).toBeNull();
    });

    it('CONFIRMED 전환: status + confirmed_at 갱신 + status_history + notification + auditLog 생성', async () => {
      const store = await createStore(prisma);
      const buyer = await setupBuyer();
      const order = await setupOrderForStore(store.id, buyer.id);
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      const now = new Date('2026-04-22T10:00:00Z');

      const updated = await repo.updateOrderStatusBySeller({
        orderId: order.id,
        storeId: store.id,
        actorAccountId: seller.id,
        toStatus: OrderStatus.CONFIRMED,
        note: null,
        now,
      });

      expect(updated?.status).toBe('CONFIRMED');
      expect(updated?.confirmed_at?.toISOString()).toBe(now.toISOString());

      const histories = await prisma.orderStatusHistory.findMany({
        where: { order_id: order.id },
      });
      expect(histories).toHaveLength(1);
      expect(histories[0].from_status).toBe('SUBMITTED');
      expect(histories[0].to_status).toBe('CONFIRMED');

      const notifications = await prisma.notification.findMany({
        where: { order_id: order.id },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].event).toBe('ORDER_CONFIRMED');
      expect(notifications[0].account_id).toBe(buyer.id);

      const auditLogs = await prisma.auditLog.findMany({
        where: { target_id: order.id, target_type: 'ORDER' },
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('STATUS_CHANGE');
    });

    it('CANCELED 전환: canceled_at 갱신되고 notification은 생성 안됨', async () => {
      const store = await createStore(prisma);
      const buyer = await setupBuyer();
      const order = await setupOrderForStore(store.id, buyer.id);
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      const now = new Date('2026-04-22T10:00:00Z');

      const updated = await repo.updateOrderStatusBySeller({
        orderId: order.id,
        storeId: store.id,
        actorAccountId: seller.id,
        toStatus: OrderStatus.CANCELED,
        note: '재고 부족',
        now,
      });

      expect(updated?.status).toBe('CANCELED');
      expect(updated?.canceled_at?.toISOString()).toBe(now.toISOString());

      // CANCELED는 notification 매핑 없음
      const notifications = await prisma.notification.findMany({
        where: { order_id: order.id },
      });
      expect(notifications).toHaveLength(0);

      const histories = await prisma.orderStatusHistory.findMany({
        where: { order_id: order.id },
      });
      expect(histories[0].note).toBe('재고 부족');
    });

    it('PICKED_UP/MADE 각각 대응 시각 컬럼 갱신', async () => {
      const store = await createStore(prisma);
      const buyer = await setupBuyer();
      const seller = await createAccount(prisma, { account_type: 'SELLER' });

      const order = await setupOrderForStore(store.id, buyer.id);
      const t1 = new Date('2026-04-22T10:00:00Z');
      const t2 = new Date('2026-04-22T11:00:00Z');
      const t3 = new Date('2026-04-22T12:00:00Z');

      await repo.updateOrderStatusBySeller({
        orderId: order.id,
        storeId: store.id,
        actorAccountId: seller.id,
        toStatus: OrderStatus.CONFIRMED,
        note: null,
        now: t1,
      });
      await repo.updateOrderStatusBySeller({
        orderId: order.id,
        storeId: store.id,
        actorAccountId: seller.id,
        toStatus: OrderStatus.MADE,
        note: null,
        now: t2,
      });
      const picked = await repo.updateOrderStatusBySeller({
        orderId: order.id,
        storeId: store.id,
        actorAccountId: seller.id,
        toStatus: OrderStatus.PICKED_UP,
        note: null,
        now: t3,
      });

      expect(picked?.made_at?.toISOString()).toBe(t2.toISOString());
      expect(picked?.picked_up_at?.toISOString()).toBe(t3.toISOString());

      const pickedNotif = await prisma.notification.findFirst({
        where: { order_id: order.id, event: 'ORDER_PICKED_UP' },
      });
      expect(pickedNotif).not.toBeNull();
    });
  });
});
