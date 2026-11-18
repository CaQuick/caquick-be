import { PubSub } from 'graphql-subscriptions';

import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { NotificationOutboxConsumer } from '@/features/notification/services/notification-outbox.consumer';
import { ORDER_STATUS_CHANGED } from '@/features/order/events/order-status-changed.event';
import {
  ORDER_SUBMITTED,
  parseOrderSubmittedPayload,
} from '@/features/order/events/order-submitted.event';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { PaymentRepository } from '@/features/order/repositories/payment.repository';
import { AdminDepositService } from '@/features/order/services/order-deposit-admin.service';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { OutboxDispatcherService } from '@/features/outbox';
import type { OrderStatus, PrismaClient } from '@/generated/prisma/client';
import { PUB_SUB } from '@/global/pubsub';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createPayment,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import {
  drainOutbox,
  OUTBOX_TEST_IMPORTS,
  outboxTestProviders,
} from '@/test/outbox';
import { collectTopic } from '@/test/pubsub';

// 2026-09-16(수) 16:00 KST
const NOW = new Date('2026-09-16T07:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;

describe('AdminDepositService (real DB)', () => {
  let service: AdminDepositService;
  let orderRepo: OrderRepository;
  let clock: ClockService;
  let dispatcher: OutboxDispatcherService;
  let pubSub: PubSub;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      imports: OUTBOX_TEST_IMPORTS,
      providers: [
        AdminDepositService,
        AccountAdminRepository,
        PaymentRepository,
        OrderTransitionRepository,
        OrderRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        OrderEventsService,
        { provide: PUB_SUB, useValue: new PubSub() },
        ...outboxTestProviders(),
        NotificationOutboxConsumer,
        NotificationRepository,
        NotificationAdminRepository,
      ],
    });
    service = module.get(AdminDepositService);
    orderRepo = module.get(OrderRepository);
    clock = module.get(ClockService);
    dispatcher = module.get(OutboxDispatcherService);
    pubSub = module.get(PUB_SUB);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    jest.spyOn(clock, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function admin(name = '운영자'): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN', name })).id;
  }

  /** 입금 대기 주문 + 결제(PENDING) + 품목. */
  async function pendingOrder(
    overrides: {
      pickupAt?: Date;
      createdAt?: Date;
      totalPrice?: number;
      depositorName?: string;
      claimedAt?: Date | null;
      status?: OrderStatus;
      paymentStatus?: 'PENDING' | 'CONFIRMED' | 'CANCELED';
    } = {},
  ) {
    const store = await createStore(prisma, { store_name: '해즈 케이크' });
    const order = await createOrder(prisma, {
      status: overrides.status ?? 'PENDING_PAYMENT',
      pickup_at: overrides.pickupAt ?? new Date(NOW.getTime() + 2 * DAY_MS),
      total_price: overrides.totalPrice ?? 30_000,
      ...(overrides.createdAt ? { created_at: overrides.createdAt } : {}),
    });
    const item = await createOrderItem(prisma, {
      order_id: order.id,
      store_id: store.id,
      product_name_snapshot: '딸기 케이크',
      quantity: 2,
    });
    const payment = await createPayment(prisma, {
      order_id: order.id,
      status: overrides.paymentStatus ?? 'PENDING',
      depositor_name: overrides.depositorName ?? '차차',
      buyer_claimed_at: overrides.claimedAt ?? null,
    });
    return { order, item, payment, storeId: store.id };
  }

  describe('adminConfirmPayment', () => {
    it('입금액이 결제 금액과 같으면 접수로 넘기고 결제·이력·감사(입금액)·마감을 남긴다', async () => {
      const adminId = await admin('김운영');
      const { order, payment } = await pendingOrder();

      const result = await service.adminConfirmPayment(adminId, {
        orderId: order.id.toString(),
        depositedAmount: 30_000,
        note: ' 국민 08:01 입금 ',
      });

      expect(result).toMatchObject({
        id: order.id.toString(),
        status: 'SUBMITTED',
        storeName: '해즈 케이크',
      });
      const saved = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { payment: true, status_histories: true },
      });
      expect(saved).toMatchObject({
        status: 'SUBMITTED',
        submitted_at: NOW,
        confirm_deadline_at: new Date(NOW.getTime() + DAY_MS),
      });
      expect(saved.payment).toMatchObject({
        id: payment.id,
        status: 'CONFIRMED',
        confirmed_at: NOW,
        confirm_source: 'ADMIN',
        confirmed_by_account_id: adminId,
        confirmed_by_label_snapshot: '김운영',
        confirm_note: '국민 08:01 입금',
      });
      expect(saved.status_histories).toEqual([
        expect.objectContaining({
          from_status: 'PENDING_PAYMENT',
          to_status: 'SUBMITTED',
          actor_type: 'ADMIN',
          actor_account_id: adminId,
          changed_at: NOW,
        }),
      ]);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'ORDER', target_id: order.id },
      });
      expect(audit).toMatchObject({
        actor_account_id: adminId,
        action: 'STATUS_CHANGE',
        before_json: { status: 'PENDING_PAYMENT' },
        after_json: {
          status: 'SUBMITTED',
          paymentAmount: 30_000,
          depositedAmount: 30_000,
          confirmSource: 'ADMIN',
          note: '국민 08:01 입금',
        },
      });
    });

    it('픽업이 24시간 안이면 확정 마감은 픽업 시각이다', async () => {
      const adminId = await admin();
      const pickupAt = new Date(NOW.getTime() + 3 * 60 * 60_000);
      const { order } = await pendingOrder({ pickupAt });

      await service.adminConfirmPayment(adminId, {
        orderId: order.id.toString(),
        depositedAmount: 30_000,
      });

      const saved = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(saved.confirm_deadline_at).toEqual(pickupAt);
    });

    it('확인 뒤 outbox(상태 전이 + 판매자 새 주문)·판매자 노출·구독(SUBMITTED)·구매자 알림이 따른다', async () => {
      const adminId = await admin();
      const { order, item, storeId } = await pendingOrder();
      // 확인 전에는 판매자에게 보이지 않는다
      expect(
        await orderRepo.findOrderDetailByStore({ orderId: order.id, storeId }),
      ).toBeNull();
      const topic = await collectTopic(pubSub, `order.seller.${storeId}`);

      await service.adminConfirmPayment(adminId, {
        orderId: order.id.toString(),
        depositedAmount: 30_000,
      });

      const events = await prisma.outbox.findMany({ orderBy: { id: 'asc' } });
      expect(events.map((e) => e.event_type)).toEqual([
        ORDER_STATUS_CHANGED,
        ORDER_SUBMITTED,
      ]);
      expect(events[1].actor_account_id).toBe(adminId);
      expect(parseOrderSubmittedPayload(events[1].payload_json)).toEqual({
        orderId: order.id.toString(),
        orderNumber: order.order_number,
        buyerAccountId: order.account_id.toString(),
        storeId: storeId.toString(),
        storeName: '해즈 케이크',
        productId: item.product_id.toString(),
        productName: '딸기 케이크',
        quantity: 2,
        pickupAt: order.pickup_at.toISOString(),
        totalPrice: 30_000,
        confirmDeadlineAt: new Date(NOW.getTime() + DAY_MS).toISOString(),
      });

      await expect(
        orderRepo.findOrderDetailByStore({ orderId: order.id, storeId }),
      ).resolves.toMatchObject({
        status: 'SUBMITTED',
        payment: { method: 'BANK_TRANSFER' },
      });
      expect(topic.received).toEqual([
        expect.objectContaining({
          kind: 'SUBMITTED',
          orderId: order.id.toString(),
          status: 'SUBMITTED',
          productName: '딸기 케이크',
          hasCustom: false,
        }),
      ]);
      topic.stop();

      await drainOutbox(dispatcher);
      const notification = await prisma.notification.findFirstOrThrow({
        where: { account_id: order.account_id },
      });
      expect(notification.event).toBe('ORDER_PAYMENT_CONFIRMED');
    });

    it('품목이 없는 주문은 매장을 알 수 없어 판매자 구독을 발행하지 않는다', async () => {
      const adminId = await admin();
      const order = await createOrder(prisma, {
        status: 'PENDING_PAYMENT',
        pickup_at: new Date(NOW.getTime() + 2 * DAY_MS),
      });
      await createPayment(prisma, { order_id: order.id });
      const publish = jest.spyOn(pubSub, 'publish');

      await expect(
        service.adminConfirmPayment(adminId, {
          orderId: order.id.toString(),
          depositedAmount: order.total_price,
        }),
      ).resolves.toMatchObject({ status: 'SUBMITTED', storeId: null });
      expect(publish).not.toHaveBeenCalled();
    });

    it('입금액이 다르면 DEPOSIT_AMOUNT_MISMATCH로 거절하고 아무것도 바꾸지 않는다', async () => {
      const adminId = await admin();
      const { order } = await pendingOrder();

      for (const depositedAmount of [0, 29_999, 30_001]) {
        await expect(
          service.adminConfirmPayment(adminId, {
            orderId: order.id.toString(),
            depositedAmount,
          }),
        ).rejects.toThrowDomain('DEPOSIT_AMOUNT_MISMATCH');
      }
      await expect(
        prisma.payment.findUniqueOrThrow({ where: { order_id: order.id } }),
      ).resolves.toMatchObject({ status: 'PENDING', confirmed_at: null });
      expect(await prisma.outbox.count()).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('결제 금액이 0원인 주문은 입금액 0으로 접수한다', async () => {
      const adminId = await admin();
      const { order } = await pendingOrder({ totalPrice: 0 });

      await expect(
        service.adminConfirmPayment(adminId, {
          orderId: order.id.toString(),
          depositedAmount: 0,
        }),
      ).resolves.toMatchObject({ status: 'SUBMITTED' });
    });

    it.each([-1, 1.5])(
      '입금액 %s는 DEPOSIT_AMOUNT_INVALID다',
      async (depositedAmount) => {
        const adminId = await admin();
        const { order } = await pendingOrder();

        await expect(
          service.adminConfirmPayment(adminId, {
            orderId: order.id.toString(),
            depositedAmount,
          }),
        ).rejects.toThrowDomain('DEPOSIT_AMOUNT_INVALID');
      },
    );

    it.each<[string, Parameters<typeof pendingOrder>[0]]>([
      [
        '입금 전 취소된 주문',
        { status: 'CANCELED', paymentStatus: 'CANCELED' },
      ],
      ['이미 확인된 주문', { status: 'SUBMITTED', paymentStatus: 'CONFIRMED' }],
    ])('%s은 PAYMENT_NOT_PENDING(409)이다', async (_case, overrides) => {
      const adminId = await admin();
      const { order } = await pendingOrder(overrides);

      await expect(
        service.adminConfirmPayment(adminId, {
          orderId: order.id.toString(),
          depositedAmount: 30_000,
        }),
      ).rejects.toThrowDomain(409);
      await expect(
        service.adminConfirmPayment(adminId, {
          orderId: order.id.toString(),
          depositedAmount: 30_000,
        }),
      ).rejects.toThrowDomain('PAYMENT_NOT_PENDING');
    });

    it('결제 기록이 없는 입금 대기 주문도 PAYMENT_NOT_PENDING이다', async () => {
      const adminId = await admin();
      const order = await createOrder(prisma, { status: 'PENDING_PAYMENT' });

      await expect(
        service.adminConfirmPayment(adminId, {
          orderId: order.id.toString(),
          depositedAmount: 10_000,
        }),
      ).rejects.toThrowDomain('PAYMENT_NOT_PENDING');
    });

    it.each([
      ['픽업 정각', 0],
      ['픽업 1분 뒤', 60_000],
    ])('%s이면 PAYMENT_PICKUP_PASSED(409)다', async (_case, sincePickupMs) => {
      const adminId = await admin();
      const { order } = await pendingOrder({
        pickupAt: new Date(NOW.getTime() - sincePickupMs),
      });

      await expect(
        service.adminConfirmPayment(adminId, {
          orderId: order.id.toString(),
          depositedAmount: 30_000,
        }),
      ).rejects.toThrowDomain('PAYMENT_PICKUP_PASSED');
      expect(await prisma.outbox.count()).toBe(0);
    });

    it("입금 기한이 지났어도 '입금했어요'로 자동 취소를 피한 주문은 확인한다", async () => {
      const adminId = await admin();
      const { order } = await pendingOrder({
        claimedAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
      });
      await prisma.payment.update({
        where: { order_id: order.id },
        data: { expires_at: new Date(NOW.getTime() - 60 * 60_000) },
      });

      await expect(
        service.adminConfirmPayment(adminId, {
          orderId: order.id.toString(),
          depositedAmount: 30_000,
        }),
      ).resolves.toMatchObject({ status: 'SUBMITTED' });
    });

    it('없거나 삭제된 주문은 ORDER_NOT_FOUND, 메모가 500자를 넘으면 TEXT_TOO_LONG이다', async () => {
      const adminId = await admin();
      const { order } = await pendingOrder();

      await expect(
        service.adminConfirmPayment(adminId, {
          orderId: order.id.toString(),
          depositedAmount: 30_000,
          note: '가'.repeat(501),
        }),
      ).rejects.toThrowDomain('TEXT_TOO_LONG');
      await prisma.order.update({
        where: { id: order.id },
        data: { deleted_at: NOW },
      });
      for (const orderId of [order.id.toString(), '999999']) {
        await expect(
          service.adminConfirmPayment(adminId, {
            orderId,
            depositedAmount: 30_000,
          }),
        ).rejects.toThrowDomain('ORDER_NOT_FOUND');
      }
    });

    it('두 관리자가 동시에 확인하면 한 명만 성공하고 나머지는 PAYMENT_NOT_PENDING이다', async () => {
      const [first, second] = [await admin('A'), await admin('B')];
      const { order } = await pendingOrder();

      const results = await Promise.allSettled(
        [first, second].map((adminId) =>
          service.adminConfirmPayment(adminId, {
            orderId: order.id.toString(),
            depositedAmount: 30_000,
          }),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected[0].reason).toMatchObject({
        code: 'PAYMENT_NOT_PENDING',
      });
      expect(
        await prisma.orderStatusHistory.count({
          where: { order_id: order.id },
        }),
      ).toBe(1);
      expect(
        await prisma.outbox.count({ where: { event_type: ORDER_SUBMITTED } }),
      ).toBe(1);
    });
  });

  describe('adminPendingPayments·adminTaskCounts', () => {
    it('입금 확인을 기다리는 주문만 생성 순으로, 키셋 커서로 넘긴다', async () => {
      const adminId = await admin();
      const a = await pendingOrder({ depositorName: '가나다' });
      const b = await pendingOrder({ depositorName: '라마바' });
      const c = await pendingOrder({ depositorName: '사아자' });
      await pendingOrder({ status: 'SUBMITTED', paymentStatus: 'CONFIRMED' });
      await pendingOrder({ status: 'CANCELED', paymentStatus: 'CANCELED' });
      const deleted = await pendingOrder();
      await prisma.order.update({
        where: { id: deleted.order.id },
        data: { deleted_at: NOW },
      });

      const itemless = await createOrder(prisma, { status: 'PENDING_PAYMENT' });
      await createPayment(prisma, { order_id: itemless.id });

      const first = await service.adminPendingPayments(adminId, { limit: 2 });
      expect(first.items.map((i) => i.orderId)).toEqual([
        a.order.id.toString(),
        b.order.id.toString(),
      ]);
      expect(first).toMatchObject({ totalCount: 4, hasMore: true });
      expect(first.items[0]).toEqual({
        orderId: a.order.id.toString(),
        orderNumber: a.order.order_number,
        storeName: '해즈 케이크',
        productName: '딸기 케이크',
        amount: 30_000,
        depositorName: '가나다',
        buyerName: a.order.buyer_name,
        buyerPhone: a.order.buyer_phone,
        createdAt: a.order.created_at,
        expiresAt: a.payment.expires_at,
        buyerClaimedAt: null,
        pickupAt: a.order.pickup_at,
      });

      const second = await service.adminPendingPayments(adminId, {
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.items.map((i) => i.orderId)).toEqual([
        c.order.id.toString(),
        itemless.id.toString(),
      ]);
      expect(second).toMatchObject({ hasMore: false, nextCursor: null });
      // 품목이 없으면 매장·상품명이 없다
      expect(second.items[1]).toMatchObject({
        storeName: null,
        productName: null,
      });
    });

    it("claimedOnly면 '입금했어요' 시각 오름차순(같은 시각은 id 순)으로 복합 커서를 쓴다", async () => {
      const adminId = await admin();
      const t1 = new Date(NOW.getTime() - 30 * 60_000);
      const t2 = new Date(NOW.getTime() - 10 * 60_000);
      const late = await pendingOrder({ claimedAt: t2 });
      const earlyA = await pendingOrder({ claimedAt: t1 });
      const earlyB = await pendingOrder({ claimedAt: t1 });
      await pendingOrder();

      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await service.adminPendingPayments(adminId, {
          claimedOnly: true,
          limit: 1,
          cursor,
        });
        expect(page.totalCount).toBe(3);
        ids.push(...page.items.map((i) => i.orderId));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      expect(ids).toEqual(
        [earlyA, earlyB, late].map((o) => o.order.id.toString()),
      );
    });

    it('금액 일치·입금자명 부분일치로 찾고, 필터 null은 생략과 같다', async () => {
      const adminId = await admin();
      const target = await pendingOrder({
        totalPrice: 45_000,
        depositorName: '홍길동',
      });
      await pendingOrder({ totalPrice: 45_000, depositorName: '김철수' });
      await pendingOrder({ totalPrice: 30_000, depositorName: '홍길순' });

      const found = await service.adminPendingPayments(adminId, {
        amount: 45_000,
        depositorName: ' 길동 ',
      });
      expect(found.items.map((i) => i.orderId)).toEqual([
        target.order.id.toString(),
      ]);

      const all = await service.adminPendingPayments(adminId, {
        claimedOnly: null,
        amount: null,
        depositorName: null,
        cursor: null,
        limit: null,
      } as never);
      expect(all.totalCount).toBe(3);
      expect((await service.adminPendingPayments(adminId)).totalCount).toBe(3);
    });

    it.each([
      [false, 'abc'],
      [true, '123'],
    ])(
      'claimedOnly=%s에 맞지 않는 커서는 INVALID_CURSOR다',
      async (claimedOnly, cursor) => {
        const adminId = await admin();
        await expect(
          service.adminPendingPayments(adminId, { claimedOnly, cursor }),
        ).rejects.toThrowDomain('INVALID_CURSOR');
      },
    );

    it("처리 대기 건수는 '입금했어요'와 전체 입금 대기를 센다", async () => {
      const adminId = await admin();
      await pendingOrder({ claimedAt: NOW });
      await pendingOrder();
      await pendingOrder({ status: 'SUBMITTED', paymentStatus: 'CONFIRMED' });

      await expect(service.adminTaskCounts(adminId)).resolves.toEqual({
        claimedPayments: 1,
        pendingPayments: 2,
      });
    });
  });
});
