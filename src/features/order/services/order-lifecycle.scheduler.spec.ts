import { Logger } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { ClockService } from '@/common/providers/clock.service';
import { HOUR_MS } from '@/common/utils/kst-time';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { OrderCancelPolicy } from '@/features/order/policies/order-cancel.policy';
import { isPaymentExpired } from '@/features/order/policies/order-lifecycle.policy';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderLifecycleRepository } from '@/features/order/repositories/order-lifecycle.repository';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import {
  LIFECYCLE_BATCH_SIZE,
  LIFECYCLE_MAX_PER_TICK,
  OrderLifecycleScheduler,
} from '@/features/order/services/order-lifecycle.scheduler';
import { StoreAdminRepository } from '@/features/store/repositories/store-admin.repository';
import type {
  OrderStatus,
  PaymentStatus,
  PrismaClient,
} from '@/generated/prisma/client';
import { AlertService } from '@/global/alerting';
import { PUB_SUB } from '@/global/pubsub';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createOrder,
  createOrderItem,
  createPayment,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';
import { collectTopic } from '@/test/pubsub';

const NOW = new Date('2026-11-19T05:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe('OrderLifecycleScheduler (real DB)', () => {
  let scheduler: OrderLifecycleScheduler;
  let lifecycle: OrderLifecycleRepository;
  let transitions: OrderTransitionRepository;
  let prisma: PrismaClient;
  let pubSub: PubSub;
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };
  const savedRole = process.env.APP_ROLE;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        OrderLifecycleScheduler,
        OrderLifecycleRepository,
        OrderTransitionRepository,
        StoreAdminRepository,
        OrderCancelPolicy,
        OrderStatusTransitionPolicy,
        OrderEventsService,
        { provide: PUB_SUB, useValue: new PubSub() },
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: ClockService, useValue: { now: () => NOW } },
        { provide: AlertService, useValue: alerts },
        ...outboxPublisherProviders({ clock: true }),
      ],
    });
    scheduler = module.get(OrderLifecycleScheduler);
    lifecycle = module.get(OrderLifecycleRepository);
    transitions = module.get(OrderTransitionRepository);
    pubSub = module.get(PUB_SUB);
    prisma = p;
  });

  afterAll(async () => {
    if (savedRole === undefined) delete process.env.APP_ROLE;
    else process.env.APP_ROLE = savedRole;
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    process.env.APP_ROLE = 'worker';
    alerts.notify.mockClear();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  async function storeOrder(opts: {
    status: OrderStatus;
    storeId?: bigint;
    pickupAt?: Date;
    submittedAt?: Date | null;
    confirmDeadlineAt?: Date | null;
    confirmReminderSentAt?: Date | null;
    payment?: {
      status: PaymentStatus;
      expiresAt?: Date;
      claimedAt?: Date | null;
    };
    commissionRateBps?: number;
  }) {
    const storeId = opts.storeId ?? (await createStore(prisma)).id;
    const order = await createOrder(prisma, {
      status: opts.status,
      pickup_at: opts.pickupAt,
      submitted_at: opts.submittedAt,
      confirm_deadline_at: opts.confirmDeadlineAt,
      confirm_reminder_sent_at: opts.confirmReminderSentAt,
      commission_rate_bps: opts.commissionRateBps,
    });
    await createOrderItem(prisma, {
      order_id: order.id,
      store_id: storeId,
      product_name_snapshot: '레터링 케이크',
    });
    if (opts.payment) {
      await createPayment(prisma, {
        order_id: order.id,
        status: opts.payment.status,
        expires_at: opts.payment.expiresAt,
        buyer_claimed_at: opts.payment.claimedAt ?? null,
        confirmed_at: opts.payment.status === 'CONFIRMED' ? at(-HOUR_MS) : null,
      });
    }
    return { order, storeId };
  }

  const orderRow = (id: bigint) =>
    prisma.order.findUniqueOrThrow({ where: { id } });
  const histories = (orderId: bigint) =>
    prisma.orderStatusHistory.findMany({
      where: { order_id: orderId },
      orderBy: { id: 'asc' },
    });
  const outboxTypes = (aggregateId: bigint) =>
    prisma.outbox
      .findMany({
        where: { aggregate_id: aggregateId.toString() },
        orderBy: { id: 'asc' },
      })
      .then((rows) => rows.map((r) => r.event_type));

  describe('① 미입금 취소', () => {
    const pending = (expiresAt: Date, claimedAt: Date | null = null) =>
      storeOrder({
        status: 'PENDING_PAYMENT',
        payment: { status: 'PENDING', expiresAt, claimedAt },
      });

    it('입금 기한 정각이면 시스템이 미입금으로 취소하고 결제를 닫는다(환불 없음)', async () => {
      const { order } = await pending(NOW);

      await scheduler.cancelExpiredPayments();

      expect(await orderRow(order.id)).toMatchObject({
        status: 'CANCELED',
        canceled_at: NOW,
      });
      expect(
        await prisma.payment.findUniqueOrThrow({
          where: { order_id: order.id },
        }),
      ).toMatchObject({ status: 'CANCELED', canceled_at: NOW });
      expect(await histories(order.id)).toEqual([
        expect.objectContaining({
          from_status: 'PENDING_PAYMENT',
          to_status: 'CANCELED',
          actor_type: 'SYSTEM',
          actor_account_id: null,
          cancel_reason: 'PAYMENT_NOT_RECEIVED',
          refund_amount: 0,
        }),
      ]);
      expect(await prisma.refund.count()).toBe(0);
      expect(await outboxTypes(order.id)).toEqual(['order.status_changed']);
    });

    it.each([
      ['기한 1ms 전', at(1), null],
      ["'입금했어요'를 누른 주문", at(-1), at(-HOUR_MS / 2)],
    ])('%s는 취소하지 않는다', async (_label, expiresAt, claimedAt) => {
      const { order } = await pending(expiresAt, claimedAt);

      await scheduler.cancelExpiredPayments();

      expect((await orderRow(order.id)).status).toBe('PENDING_PAYMENT');
      expect(await histories(order.id)).toHaveLength(0);
    });

    it('입금 대기라도 판매자 구독은 발행하지 않는다(판매자에게 보인 적 없음)', async () => {
      const { order, storeId } = await pending(at(-1));
      const topic = await collectTopic(pubSub, `order.seller.${storeId}`);

      await scheduler.cancelExpiredPayments();

      expect((await orderRow(order.id)).status).toBe('CANCELED');
      expect(topic.received).toHaveLength(0);
      topic.stop();
    });
  });

  describe('② 확정 마감 2시간 전 미리 알림', () => {
    const submitted = (
      deadline: Date,
      submittedAt: Date,
      sentAt: Date | null = null,
    ) =>
      storeOrder({
        status: 'SUBMITTED',
        submittedAt,
        confirmDeadlineAt: deadline,
        confirmReminderSentAt: sentAt,
        payment: { status: 'CONFIRMED' },
      });

    it('마감 2시간 전 구간에 들면 한 번만 보낸다(다음 틱은 보내지 않음)', async () => {
      const { order } = await submitted(at(2 * HOUR_MS), at(-20 * HOUR_MS));

      await scheduler.remindConfirmDeadlines();
      await scheduler.remindConfirmDeadlines();

      expect((await orderRow(order.id)).confirm_reminder_sent_at).toEqual(NOW);
      expect(await outboxTypes(order.id)).toEqual([
        'order.confirm_reminder_due',
      ]);
      const [event] = await prisma.outbox.findMany();
      expect(event.payload_json).toMatchObject({
        orderId: order.id.toString(),
        productName: '레터링 케이크',
        confirmDeadlineAt: at(2 * HOUR_MS).toISOString(),
      });
    });

    it.each([
      ['마감 2시간 전보다 이르다', at(2 * HOUR_MS + 1), at(-20 * HOUR_MS)],
      ['마감이 지났다(미확정 취소 몫)', NOW, at(-20 * HOUR_MS)],
      // 마감 − 2시간 ≤ 접수: 새 주문 푸시가 마감 시각을 실었다
      ['마감 2시간 미만으로 접수됐다', at(HOUR_MS), at(-HOUR_MS / 2)],
      ['마감 정확히 2시간 전에 접수됐다', at(HOUR_MS), at(-HOUR_MS)],
    ])('%s면 보내지 않는다', async (_label, deadline, submittedAt) => {
      const { order } = await submitted(deadline, submittedAt);

      // 후보 조회(SQL)와 잠금 뒤 재판정이 같은 조건을 본다
      expect(
        await lifecycle.findConfirmReminderDueIds({ now: NOW, limit: 10 }),
      ).toEqual([]);
      await scheduler.remindConfirmDeadlines();

      expect((await orderRow(order.id)).confirm_reminder_sent_at).toBeNull();
      expect(await outboxTypes(order.id)).toEqual([]);
    });

    it('마감 − 2시간이 접수 시각보다 1ms 뒤면 보낸다(경계)', async () => {
      const submittedAt = at(-HOUR_MS);
      const deadline = new Date(submittedAt.getTime() + 2 * HOUR_MS + 1);
      const { order } = await submitted(deadline, submittedAt);

      await scheduler.remindConfirmDeadlines();

      expect(await outboxTypes(order.id)).toEqual([
        'order.confirm_reminder_due',
      ]);
    });

    it('품목이 없는 주문은 보낼 매장을 몰라 표시만 남기고 이벤트는 없다', async () => {
      const order = await createOrder(prisma, {
        status: 'SUBMITTED',
        submitted_at: at(-20 * HOUR_MS),
        confirm_deadline_at: at(HOUR_MS),
      });

      await scheduler.remindConfirmDeadlines();

      expect((await orderRow(order.id)).confirm_reminder_sent_at).toEqual(NOW);
      expect(await outboxTypes(order.id)).toEqual([]);
    });

    it('잠금 뒤 다시 보면 대상이 아닌 주문(그사이 확정)은 표시도 이벤트도 없다', async () => {
      const { order } = await submitted(at(HOUR_MS), at(-20 * HOUR_MS));
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'CONFIRMED' },
      });

      const sent = await lifecycle.markConfirmReminderSent({
        orderId: order.id,
        now: NOW,
        isDue: () => false,
      });

      expect(sent).toBe(false);
      expect((await orderRow(order.id)).confirm_reminder_sent_at).toBeNull();
    });
  });

  describe('③ 미확정 자동 취소', () => {
    it('확정 마감 정각이면 미확정으로 취소하고 전액 환불을 만든다(판매자 구독 발행)', async () => {
      const { order, storeId } = await storeOrder({
        status: 'SUBMITTED',
        confirmDeadlineAt: NOW,
        payment: { status: 'CONFIRMED' },
      });
      const topic = await collectTopic(pubSub, `order.seller.${storeId}`);

      await scheduler.cancelConfirmTimeouts();

      expect((await orderRow(order.id)).status).toBe('CANCELED');
      expect(await histories(order.id)).toEqual([
        expect.objectContaining({
          actor_type: 'SYSTEM',
          cancel_reason: 'CONFIRM_TIMEOUT',
          refund_amount: 10_000,
        }),
      ]);
      expect(
        await prisma.refund.findFirstOrThrow({ where: { order_id: order.id } }),
      ).toMatchObject({
        kind: 'CANCEL',
        amount: 10_000,
        status: 'AWAITING_ACCOUNT',
      });
      expect(await outboxTypes(order.id)).toEqual([
        'order.status_changed',
        'refund.requested',
      ]);
      expect(topic.received).toEqual([
        expect.objectContaining({ kind: 'STATUS_CHANGED', status: 'CANCELED' }),
      ]);
      topic.stop();
    });

    it.each([
      ['마감 1ms 전', at(1)],
      ['결제 도입 전 접수(마감 없음)', null],
    ])('%s는 취소하지 않는다', async (_label, deadline) => {
      const { order } = await storeOrder({
        status: 'SUBMITTED',
        confirmDeadlineAt: deadline,
      });

      await scheduler.cancelConfirmTimeouts();

      expect((await orderRow(order.id)).status).toBe('SUBMITTED');
    });

    it('숨긴 매장의 주문도 미확정 취소는 그대로 한다', async () => {
      const store = await createStore(prisma, { is_active: false });
      const { order } = await storeOrder({
        status: 'SUBMITTED',
        storeId: store.id,
        confirmDeadlineAt: at(-1),
        payment: { status: 'CONFIRMED' },
      });

      await scheduler.cancelConfirmTimeouts();

      expect((await orderRow(order.id)).status).toBe('CANCELED');
    });
  });

  describe('④ 자동 픽업 완료', () => {
    const overdue = at(-24 * HOUR_MS);

    it.each(['CONFIRMED', 'MADE'] as const)(
      '%s는 픽업 + 24시간 정각에 픽업 완료되고 확인된 결제액으로 정산을 확정한다',
      async (status) => {
        const { order } = await storeOrder({
          status,
          pickupAt: overdue,
          payment: { status: 'CONFIRMED' },
          commissionRateBps: 333,
        });

        await scheduler.completeOverduePickups();

        expect(await orderRow(order.id)).toMatchObject({
          status: 'PICKED_UP',
          picked_up_at: NOW,
          settlement_base_amount: 10_000,
          commission_amount: 333,
          settlement_finalized_at: NOW,
        });
        expect(await histories(order.id)).toEqual([
          expect.objectContaining({
            from_status: status,
            to_status: 'PICKED_UP',
            actor_type: 'SYSTEM',
            actor_account_id: null,
          }),
        ]);
        expect(await outboxTypes(order.id)).toEqual(['order.status_changed']);
        expect(await prisma.auditLog.count()).toBe(0);
      },
    );

    it('픽업 + 24시간 1ms 전이면 바꾸지 않는다', async () => {
      const { order } = await storeOrder({
        status: 'MADE',
        pickupAt: at(-24 * HOUR_MS + 1),
      });

      await scheduler.completeOverduePickups();

      expect((await orderRow(order.id)).status).toBe('MADE');
    });

    it('확인된 결제가 없는 주문(결제 도입 전)은 픽업 완료만 하고 정산은 건너뛴다', async () => {
      const { order } = await storeOrder({ status: 'MADE', pickupAt: overdue });

      await scheduler.completeOverduePickups();

      expect(await orderRow(order.id)).toMatchObject({
        status: 'PICKED_UP',
        settlement_base_amount: null,
        settlement_finalized_at: null,
      });
    });

    it('숨긴 매장의 주문은 건너뛰고(관리자 건별 처리) 활성 매장 주문만 바꾼다', async () => {
      const hidden = await createStore(prisma, { is_active: false });
      const skipped = await storeOrder({
        status: 'MADE',
        storeId: hidden.id,
        pickupAt: overdue,
      });
      const done = await storeOrder({ status: 'MADE', pickupAt: overdue });

      await scheduler.completeOverduePickups();

      expect((await orderRow(skipped.order.id)).status).toBe('MADE');
      expect((await orderRow(done.order.id)).status).toBe('PICKED_UP');

      // 반증: 매장을 다시 보이면 다음 틱에 픽업 완료된다
      await prisma.store.update({
        where: { id: hidden.id },
        data: { is_active: true },
      });
      await scheduler.completeOverduePickups();
      expect((await orderRow(skipped.order.id)).status).toBe('PICKED_UP');
    });
  });

  describe('동시 실행', () => {
    it('같은 주문의 미입금 취소가 두 tx에서 겹쳐도 한 번만 전이한다', async () => {
      const { order } = await storeOrder({
        status: 'PENDING_PAYMENT',
        payment: { status: 'PENDING', expiresAt: at(-1) },
      });
      const cancel = () =>
        transitions.cancel({
          orderId: order.id,
          actor: 'SYSTEM',
          actorAccountId: null,
          scope: { kind: 'any' },
          note: null,
          now: NOW,
          eligible: (s) => isPaymentExpired(s, NOW),
          decide: (state) =>
            new OrderCancelPolicy().decide(
              { actor: 'SYSTEM', reason: 'PAYMENT_NOT_RECEIVED' },
              state,
            ),
        });

      const results = await Promise.all([cancel(), cancel()]);

      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await histories(order.id)).toHaveLength(1);
    });

    it('같은 주문의 자동 픽업 완료가 두 tx에서 겹쳐도 한 번만 전이한다', async () => {
      const { order } = await storeOrder({
        status: 'MADE',
        pickupAt: at(-24 * HOUR_MS),
        payment: { status: 'CONFIRMED' },
      });
      const policy = new OrderStatusTransitionPolicy();
      const complete = () =>
        transitions.completePickupBySystem({
          orderId: order.id,
          now: NOW,
          eligible: (s) =>
            policy.canTransition({
              actor: 'SYSTEM',
              from: s.status,
              to: 'PICKED_UP',
              now: NOW,
              pickupAt: s.pickupAt,
            }),
        });

      const results = await Promise.all([complete(), complete()]);

      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await histories(order.id)).toHaveLength(1);
      expect(await outboxTypes(order.id)).toEqual(['order.status_changed']);
    });

    it('잠금 뒤 판매자가 먼저 노쇼로 바꿨으면 자동 픽업 완료는 건너뛴다', async () => {
      const { order } = await storeOrder({
        status: 'MADE',
        pickupAt: at(-24 * HOUR_MS),
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'NO_SHOW' },
      });

      const result = await transitions.completePickupBySystem({
        orderId: order.id,
        now: NOW,
        eligible: (s) => s.status === 'MADE',
      });

      expect(result).toBeNull();
      expect((await orderRow(order.id)).status).toBe('NO_SHOW');
    });

    it('같은 작업의 틱이 겹치면 뒤 틱은 건너뛴다', async () => {
      let release!: () => void;
      const spy = jest
        .spyOn(lifecycle, 'findPaymentExpiredIds')
        .mockImplementation(
          () => new Promise((resolve) => (release = () => resolve([]))),
        );

      const first = scheduler.cancelExpiredPayments();
      await scheduler.cancelExpiredPayments();
      release();
      await first;

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('배치·실패·역할', () => {
    it(`후보를 ${LIFECYCLE_BATCH_SIZE}건씩 id 키셋으로 넘기고 한 틱에 ${LIFECYCLE_MAX_PER_TICK}건에서 멈춘다`, async () => {
      const page = Array.from({ length: LIFECYCLE_BATCH_SIZE }, (_, i) =>
        BigInt(i + 1),
      );
      const find = jest
        .spyOn(lifecycle, 'findConfirmTimedOutIds')
        .mockResolvedValue(page);
      jest.spyOn(transitions, 'cancel').mockResolvedValue(null);

      await scheduler.cancelConfirmTimeouts();

      expect(find).toHaveBeenCalledTimes(
        LIFECYCLE_MAX_PER_TICK / LIFECYCLE_BATCH_SIZE,
      );
      expect(find.mock.calls[0][0]).toMatchObject({ afterId: undefined });
      expect(find.mock.calls[1][0]).toMatchObject({
        afterId: BigInt(LIFECYCLE_BATCH_SIZE),
        limit: LIFECYCLE_BATCH_SIZE,
      });
    });

    it('한 건이 실패하면 경보를 남기고 다음 건을 처리한다', async () => {
      const first = await storeOrder({
        status: 'MADE',
        pickupAt: at(-25 * HOUR_MS),
      });
      const second = await storeOrder({
        status: 'MADE',
        pickupAt: at(-25 * HOUR_MS),
      });
      const original = transitions.completePickupBySystem.bind(transitions);
      jest
        .spyOn(transitions, 'completePickupBySystem')
        .mockImplementation((args) =>
          args.orderId === first.order.id
            ? Promise.reject(new Error('잠금 대기 시간 초과'))
            : original(args),
        );

      await scheduler.completeOverduePickups();

      expect((await orderRow(first.order.id)).status).toBe('MADE');
      expect((await orderRow(second.order.id)).status).toBe('PICKED_UP');
      expect(alerts.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          key: 'order-cron:auto-pickup',
          detail: `주문 ${first.order.id}: 잠금 대기 시간 초과`,
        }),
      );
    });

    it('후보 조회가 던지면 그 틱을 접고 경보한다', async () => {
      jest
        .spyOn(lifecycle, 'findConfirmReminderDueIds')
        .mockRejectedValue(new Error('db down'));

      await expect(scheduler.remindConfirmDeadlines()).resolves.toBeUndefined();

      expect(alerts.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'order-cron:confirm-reminder',
          detail: 'db down',
        }),
      );
    });

    it.each(['api', 'ws'])(
      '%s 역할에서는 아무것도 하지 않는다',
      async (role) => {
        process.env.APP_ROLE = role;
        const { order } = await storeOrder({
          status: 'PENDING_PAYMENT',
          payment: { status: 'PENDING', expiresAt: at(-1) },
        });

        await scheduler.cancelExpiredPayments();
        await scheduler.remindConfirmDeadlines();
        await scheduler.cancelConfirmTimeouts();
        await scheduler.completeOverduePickups();

        expect((await orderRow(order.id)).status).toBe('PENDING_PAYMENT');
      },
    );
  });
});
