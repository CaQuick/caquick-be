import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { NotificationOutboxConsumer } from '@/features/notification/services/notification-outbox.consumer';
import {
  ORDER_SUBMITTED,
  parseOrderSubmittedPayload,
} from '@/features/order/events/order-submitted.event';
import {
  type CreateSubmittedOrderArgs,
  type DailyCapacityGuard,
  OrderRepository,
} from '@/features/order/repositories/order.repository';
import { OutboxDispatcherService } from '@/features/outbox';
import type { PrismaClient } from '@/generated/prisma/client';
import { OrderStatus } from '@/generated/prisma/client';
import { RequestContextService } from '@/global/request-context';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createStore,
  createStoreDailyCapacity,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import {
  drainOutbox,
  OUTBOX_TEST_IMPORTS,
  outboxTestProviders,
} from '@/test/outbox';

describe('OrderRepository (real DB)', () => {
  let repo: OrderRepository;
  let prisma: PrismaClient;
  let dispatcher: OutboxDispatcherService;
  let requestContext: RequestContextService;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      imports: OUTBOX_TEST_IMPORTS,
      providers: [
        OrderRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        ...outboxTestProviders(),
        NotificationOutboxConsumer,
        NotificationRepository,
        NotificationAdminRepository,
      ],
    });
    repo = module.get(OrderRepository);
    dispatcher = module.get(OutboxDispatcherService);
    requestContext = module.get(RequestContextService);
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

  describe('멱등 키 조회', () => {
    it('활성 주문 조회는 soft-delete된 주문을 반환하지 않는다', async () => {
      const buyer = await setupBuyer();
      await createOrder(prisma, {
        account_id: buyer.id,
        idempotency_key: 'k-deleted',
        deleted_at: new Date(),
      });

      expect(
        await repo.findOrderByIdempotencyKey(buyer.id, 'k-deleted'),
      ).toBeNull();
    });

    it('키 점유 확인은 soft-delete된 주문을 찾아낸다(extension 우회 계약)', async () => {
      const buyer = await setupBuyer();
      await createOrder(prisma, {
        account_id: buyer.id,
        idempotency_key: 'k-deleted',
        deleted_at: new Date(),
      });
      await createOrder(prisma, {
        account_id: buyer.id,
        idempotency_key: 'k-active',
      });

      // MySQL unique는 deleted_at을 보지 않아 삭제된 주문도 키를 계속 점유한다
      expect(
        await repo.existsDeletedOrderWithIdempotencyKey(buyer.id, 'k-deleted'),
      ).toBe(true);
      // 활성 주문이 쥔 키는 '삭제가 점유' 케이스가 아니다
      expect(
        await repo.existsDeletedOrderWithIdempotencyKey(buyer.id, 'k-active'),
      ).toBe(false);
    });
  });

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

    it('첫 item(주문 시점 썸네일 스냅샷 포함)을 반환한다', async () => {
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
      expect(rows[0].items[0].product_thumbnail_url_snapshot).toBe(
        'https://i.example/1.png',
      );
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

  describe('findReviewableOrderIds', () => {
    it('soft-delete된 주문의 아이템은 리뷰 가능 집계에서 제외한다', async () => {
      const buyer = await setupBuyer();
      const active = await createOrder(prisma, {
        account_id: buyer.id,
        status: 'PICKED_UP',
      });
      await createOrderItem(prisma, { order_id: active.id });
      const deleted = await createOrder(prisma, {
        account_id: buyer.id,
        status: 'PICKED_UP',
        deleted_at: new Date(),
      });
      await createOrderItem(prisma, { order_id: deleted.id });

      const ids = await repo.findReviewableOrderIds({
        accountId: buyer.id,
        orderIds: [active.id, deleted.id],
      });
      expect(ids).toEqual(new Set([active.id.toString()]));
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

    it('toCreatedAt / fromPickupAt / toPickupAt 필터가 각각 동작한다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);

      const oldOrder = await prisma.order.create({
        data: {
          account_id: buyer.id,
          order_number: 'OLD-2',
          status: 'SUBMITTED',
          pickup_at: new Date('2026-01-15'),
          buyer_name: 'x',
          buyer_phone: '010-0000-0000',
          subtotal_price: 0,
          discount_price: 0,
          total_price: 0,
          created_at: new Date('2025-06-01'),
        },
      });
      await createOrderItem(prisma, {
        order_id: oldOrder.id,
        store_id: store.id,
      });

      const newOrder = await prisma.order.create({
        data: {
          account_id: buyer.id,
          order_number: 'NEW-2',
          status: 'SUBMITTED',
          pickup_at: new Date('2026-06-15'),
          buyer_name: 'y',
          buyer_phone: '010-1111-1111',
          subtotal_price: 0,
          discount_price: 0,
          total_price: 0,
          created_at: new Date('2026-05-01'),
        },
      });
      await createOrderItem(prisma, {
        order_id: newOrder.id,
        store_id: store.id,
      });

      // toCreatedAt 단독: 2025-06 만 통과
      const byTo = await repo.listOrdersByStore({
        storeId: store.id,
        limit: 10,
        toCreatedAt: new Date('2026-01-01'),
      });
      expect(byTo.map((r) => r.id)).toEqual([oldOrder.id]);

      // fromPickupAt/toPickupAt 조합: 2026-03 ~ 2026-08 (newOrder만)
      const byPickup = await repo.listOrdersByStore({
        storeId: store.id,
        limit: 10,
        fromPickupAt: new Date('2026-03-01'),
        toPickupAt: new Date('2026-08-01'),
      });
      expect(byPickup.map((r) => r.id)).toEqual([newOrder.id]);
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

  describe('aggregateStoreOrdersInRange', () => {
    const from = new Date('2026-10-04T15:00:00Z');
    const to = new Date('2026-10-05T15:00:00Z');
    const inside = new Date('2026-10-05T03:00:00Z');
    const before = new Date('2026-10-04T14:59:59.999Z');

    async function storeOrder(
      storeId: bigint,
      overrides: Parameters<typeof createOrder>[1] & { itemDeletedAt?: Date },
    ) {
      const { itemDeletedAt, ...orderOverrides } = overrides;
      const order = await createOrder(prisma, orderOverrides);
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: storeId,
        ...(itemDeletedAt ? { deleted_at: itemDeletedAt } : {}),
      });
      return order;
    }

    it('basis가 기준 컬럼을 고르고 범위는 [from, to)다', async () => {
      const store = await createStore(prisma);
      // 픽업은 범위 안, 생성은 범위 밖
      await storeOrder(store.id, {
        pickup_at: inside,
        created_at: before,
        total_price: 1_000,
      });
      // 경계: from은 포함, to는 제외
      await storeOrder(store.id, {
        pickup_at: from,
        created_at: to,
        total_price: 10,
      });
      await storeOrder(store.id, {
        pickup_at: to,
        created_at: from,
        total_price: 100,
      });

      const base = { storeId: store.id, from, to };
      expect(
        await repo.aggregateStoreOrdersInRange({ ...base, basis: 'pickup' }),
      ).toEqual({ orderCount: 2, salesAmount: 1_010 });
      expect(
        await repo.aggregateStoreOrdersInRange({ ...base, basis: 'created' }),
      ).toEqual({ orderCount: 1, salesAmount: 100 });
    });

    it('CANCELED·soft-delete 주문·품목이 soft-delete된 주문·다른 매장은 제외한다', async () => {
      const store = await createStore(prisma);
      const other = await createStore(prisma);
      await storeOrder(store.id, { pickup_at: inside, total_price: 1_000 });
      await storeOrder(store.id, {
        pickup_at: inside,
        status: 'CANCELED',
        total_price: 2_000,
      });
      await storeOrder(store.id, {
        pickup_at: inside,
        deleted_at: inside,
        total_price: 4_000,
      });
      await storeOrder(store.id, {
        pickup_at: inside,
        itemDeletedAt: inside,
        total_price: 8_000,
      });
      await storeOrder(other.id, { pickup_at: inside, total_price: 16_000 });

      expect(
        await repo.aggregateStoreOrdersInRange({
          storeId: store.id,
          from,
          to,
          basis: 'pickup',
        }),
      ).toEqual({ orderCount: 1, salesAmount: 1_000 });
    });

    it('해당 주문이 없으면 0·0이다', async () => {
      const store = await createStore(prisma);
      expect(
        await repo.aggregateStoreOrdersInRange({
          storeId: store.id,
          from,
          to,
          basis: 'created',
        }),
      ).toEqual({ orderCount: 0, salesAmount: 0 });
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

    it('잠금 시점 상태로 assertTransition이 던지면 롤백된다(이력 없음)', async () => {
      const store = await createStore(prisma);
      const buyer = await setupBuyer();
      const order = await setupOrderForStore(store.id, buyer.id);
      const seller = await createAccount(prisma, { account_type: 'SELLER' });

      await expect(
        repo.updateOrderStatusBySeller({
          orderId: order.id,
          storeId: store.id,
          actorAccountId: seller.id,
          toStatus: OrderStatus.CONFIRMED,
          assertTransition: (from) => {
            throw new Error(`stale:${from}`);
          },
          note: null,
          now: new Date(),
        }),
      ).rejects.toThrow('stale:SUBMITTED');
      const row = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(row.status).toBe('SUBMITTED');
      expect(
        await prisma.orderStatusHistory.count({
          where: { order_id: order.id },
        }),
      ).toBe(0);
    });

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
        assertTransition: () => undefined,
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
        assertTransition: () => undefined,
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

      // 알림은 outbox 소비자가 만든다 — 같은 tx에 적재된 이벤트를 소진한 뒤 본다
      await drainOutbox(dispatcher);
      const notifications = await prisma.notification.findMany({
        where: { order_id: order.id },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].event).toBe('ORDER_CONFIRMED');
      expect(notifications[0].created_at).toEqual(now);
      expect(notifications[0].account_id).toBe(buyer.id);
      // 알림센터 서브라인·딥링크용 연관 ID까지 저장한다
      expect(notifications[0].store_id).toBe(store.id);
      expect(notifications[0].product_id).not.toBeNull();

      const auditLogs = await prisma.auditLog.findMany({
        where: { target_id: order.id, target_type: 'ORDER' },
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('STATUS_CHANGE');
    });

    it('ip/ua를 넘기지 않아도 요청 컨텍스트에서 보강해 감사에 남긴다', async () => {
      const store = await createStore(prisma);
      const buyer = await setupBuyer();
      const order = await setupOrderForStore(store.id, buyer.id);
      const seller = await createAccount(prisma, { account_type: 'SELLER' });

      await requestContext.run(
        { clientIp: '203.0.113.9', userAgent: 'seller-app' },
        async () => {
          await repo.updateOrderStatusBySeller({
            orderId: order.id,
            storeId: store.id,
            actorAccountId: seller.id,
            toStatus: OrderStatus.CONFIRMED,
            assertTransition: () => undefined,
            note: null,
            now: new Date('2026-04-22T10:00:00Z'),
          });
        },
      );

      const auditLogs = await prisma.auditLog.findMany({
        where: { target_id: order.id, target_type: 'ORDER' },
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].ip_address).toBe('203.0.113.9');
      expect(auditLogs[0].user_agent).toBe('seller-app');
    });

    it('CANCELED 전환: canceled_at 갱신되고 ORDER_CANCELED notification이 생성된다', async () => {
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
        assertTransition: () => undefined,
        note: '재고 부족',
        now,
      });

      expect(updated?.status).toBe('CANCELED');
      expect(updated?.canceled_at?.toISOString()).toBe(now.toISOString());

      // 취소도 구매자에게 알린다(판매자·운영자 취소 공통)
      await drainOutbox(dispatcher);
      const notifications = await prisma.notification.findMany({
        where: { order_id: order.id },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        account_id: buyer.id,
        type: 'ORDER_STATUS',
        event: 'ORDER_CANCELED',
        store_id: store.id,
      });

      const histories = await prisma.orderStatusHistory.findMany({
        where: { order_id: order.id },
      });
      expect(histories[0].note).toBe('재고 부족');
    });

    it('CONFIRMED→MADE→PICKED_UP 연속 전이 시 각 타임스탬프 컬럼이 누적 기록된다', async () => {
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
        assertTransition: () => undefined,
        note: null,
        now: t1,
      });
      await repo.updateOrderStatusBySeller({
        orderId: order.id,
        storeId: store.id,
        actorAccountId: seller.id,
        toStatus: OrderStatus.MADE,
        assertTransition: () => undefined,
        note: null,
        now: t2,
      });
      const picked = await repo.updateOrderStatusBySeller({
        orderId: order.id,
        storeId: store.id,
        actorAccountId: seller.id,
        toStatus: OrderStatus.PICKED_UP,
        assertTransition: () => undefined,
        note: null,
        now: t3,
      });

      expect(picked?.status).toBe('PICKED_UP');
      expect(picked?.confirmed_at?.toISOString()).toBe(t1.toISOString());
      expect(picked?.made_at?.toISOString()).toBe(t2.toISOString());
      expect(picked?.picked_up_at?.toISOString()).toBe(t3.toISOString());

      const histories = await prisma.orderStatusHistory.findMany({
        where: { order_id: order.id },
        orderBy: { changed_at: 'asc' },
      });
      expect(histories.map((h) => h.to_status)).toEqual([
        'CONFIRMED',
        'MADE',
        'PICKED_UP',
      ]);

      await drainOutbox(dispatcher);
      const notifEvents = (
        await prisma.notification.findMany({
          where: { order_id: order.id },
          orderBy: { id: 'asc' },
        })
      ).map((n) => n.event);
      expect(notifEvents).toEqual([
        'ORDER_CONFIRMED',
        'ORDER_MADE',
        'ORDER_PICKED_UP',
      ]);
    });
  });

  describe('createSubmittedOrder', () => {
    const PICKUP_AT = new Date('2026-09-18T05:00:00.000Z');
    const SUBMITTED_AT = new Date('2026-09-16T07:00:00.000Z');

    function submitArgs(args: {
      buyerId: bigint;
      store: { id: bigint; store_name: string };
      product: { id: bigint; name: string };
      orderNumber?: string;
      quantity?: number;
      capacityGuard?: DailyCapacityGuard;
    }): CreateSubmittedOrderArgs {
      const quantity = args.quantity ?? 2;
      return {
        accountId: args.buyerId,
        orderNumber: args.orderNumber ?? 'ORD-20260916-ABC234',
        idempotencyKey: `idem-${args.orderNumber ?? 'base'}`,
        pickupAt: PICKUP_AT,
        buyerName: '차차',
        buyerPhone: '010-0000-1111',
        subtotalPrice: 30000 * quantity,
        discountPrice: 5000 * quantity,
        totalPrice: 25000 * quantity,
        submittedAt: SUBMITTED_AT,
        capacityGuard: args.capacityGuard ?? null,
        item: {
          storeId: args.store.id,
          productId: args.product.id,
          productNameSnapshot: args.product.name,
          storeNameSnapshot: args.store.store_name,
          productThumbnailUrlSnapshot: null,
          regularPriceSnapshot: 30000,
          salePriceSnapshot: 25000,
          quantity,
          itemSubtotalPrice: 25000 * quantity,
          options: [],
        },
      };
    }

    it('접수 이벤트(order.submitted)를 같은 tx에 1건 남기고 payload는 생성 시점 스냅샷이다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma, { store_name: '해즈 케이크' });
      const product = await createProduct(prisma, {
        store_id: store.id,
        name: '딸기 케이크',
      });

      const created = await repo.createSubmittedOrder(
        submitArgs({ buyerId: buyer.id, store, product }),
      );

      const events = await prisma.outbox.findMany();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        aggregate_type: 'order',
        aggregate_id: created!.id.toString(),
        event_type: ORDER_SUBMITTED,
        occurred_at: SUBMITTED_AT,
        actor_account_id: buyer.id,
        status: 'PENDING',
      });
      expect(parseOrderSubmittedPayload(events[0].payload_json)).toEqual({
        orderId: created!.id.toString(),
        orderNumber: 'ORD-20260916-ABC234',
        buyerAccountId: buyer.id.toString(),
        storeId: store.id.toString(),
        storeName: '해즈 케이크',
        productId: product.id.toString(),
        productName: '딸기 케이크',
        quantity: 2,
        pickupAt: PICKUP_AT.toISOString(),
        totalPrice: 50000,
      });
    });

    it('반증: capacity 재검사에서 거절되면 주문도 이벤트도 남지 않는다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: new Date(Date.UTC(2026, 8, 18)),
        capacity: 1,
      });

      const created = await repo.createSubmittedOrder(
        submitArgs({
          buyerId: buyer.id,
          store,
          product,
          quantity: 2,
          capacityGuard: {
            storeId: store.id,
            dateOnlyUtc: new Date(Date.UTC(2026, 8, 18)),
            dayStartUtc: new Date('2026-09-17T15:00:00.000Z'),
            dayEndUtc: new Date('2026-09-18T15:00:00.000Z'),
          },
        }),
      );

      expect(created).toBeNull();
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.outbox.count()).toBe(0);
    });

    it('반증: order_number 충돌로 tx가 롤백되면 이벤트도 남지 않는다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      await createOrder(prisma, { order_number: 'ORD-20260916-DUP000' });

      await expect(
        repo.createSubmittedOrder(
          submitArgs({
            buyerId: buyer.id,
            store,
            product,
            orderNumber: 'ORD-20260916-DUP000',
          }),
        ),
      ).rejects.toMatchObject({ code: 'P2002' });

      expect(await prisma.outbox.count()).toBe(0);
    });
  });
});
