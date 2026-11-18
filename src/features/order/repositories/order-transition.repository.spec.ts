import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ORDER_STATUS_CHANGED } from '@/features/order/events/order-status-changed.event';
import { REFUND_REQUESTED } from '@/features/order/events/refund-requested.event';
import {
  OrderCancelPolicy,
  type OrderCancelDecision,
  type OrderCancelRequest,
} from '@/features/order/policies/order-cancel.policy';
import { assertPaymentConfirmable } from '@/features/order/policies/payment-confirm.policy';
import {
  OrderTransitionRepository,
  type CancelOrderArgs,
  type ConfirmPaymentArgs,
  type OrderCancelScope,
} from '@/features/order/repositories/order-transition.repository';
import type { OrderStatus, PrismaClient } from '@/generated/prisma/client';
import { requestContextStorage } from '@/global/request-context';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createPayment,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

const NOW = new Date('2026-09-16T07:00:00.000Z');

describe('OrderTransitionRepository (real DB)', () => {
  let repo: OrderTransitionRepository;
  let auditLogs: AuditLogRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        OrderTransitionRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        ...outboxPublisherProviders(),
      ],
    });
    repo = module.get(OrderTransitionRepository);
    auditLogs = module.get(AUDIT_LOG_REPOSITORY);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function confirmArgs(
    orderId: bigint,
    overrides: Partial<ConfirmPaymentArgs> = {},
  ): Promise<ConfirmPaymentArgs> {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    return {
      orderId,
      source: 'ADMIN',
      actorAccountId: actor.id,
      actorLabel: null,
      depositedAmount: 10_000,
      note: null,
      now: NOW,
      assertConfirmable: () => undefined,
      ...overrides,
    };
  }

  describe('confirmPayment', () => {
    it('품목이 없는 주문은 매장을 알 수 없어 판매자 새 주문 이벤트 없이 접수한다', async () => {
      const order = await createOrder(prisma, {
        status: 'PENDING_PAYMENT',
        pickup_at: new Date(NOW.getTime() + 48 * 60 * 60_000),
      });
      await createPayment(prisma, { order_id: order.id });

      const updated = await repo.confirmPayment(await confirmArgs(order.id));

      expect(updated).toMatchObject({ status: 'SUBMITTED', items: [] });
      const events = await prisma.outbox.findMany();
      expect(events.map((e) => e.event_type)).toEqual([ORDER_STATUS_CHANGED]);
      await expect(
        prisma.auditLog.findFirstOrThrow({ where: { target_id: order.id } }),
      ).resolves.toMatchObject({ store_id: null });
    });

    it('자동 매칭(AUTO) 확인은 이력 주체를 SYSTEM으로 남긴다', async () => {
      const order = await createOrder(prisma, {
        status: 'PENDING_PAYMENT',
        pickup_at: new Date(NOW.getTime() + 48 * 60 * 60_000),
      });
      await createPayment(prisma, { order_id: order.id });

      await repo.confirmPayment(
        await confirmArgs(order.id, { source: 'AUTO' }),
      );

      await expect(
        prisma.orderStatusHistory.findFirstOrThrow({
          where: { order_id: order.id },
        }),
      ).resolves.toMatchObject({ actor_type: 'SYSTEM' });
      await expect(
        prisma.payment.findUniqueOrThrow({ where: { order_id: order.id } }),
      ).resolves.toMatchObject({ confirm_source: 'AUTO' });
    });

    it('잠금 뒤 판정이 던지면 롤백되어 아무것도 남지 않는다', async () => {
      const order = await createOrder(prisma, { status: 'PENDING_PAYMENT' });
      await createPayment(prisma, { order_id: order.id });
      const seen: unknown[] = [];

      await expect(
        repo.confirmPayment(
          await confirmArgs(order.id, {
            assertConfirmable: (state) => {
              seen.push(state);
              throw new Error('거절');
            },
          }),
        ),
      ).rejects.toThrow('거절');

      expect(seen).toEqual([
        {
          orderStatus: 'PENDING_PAYMENT',
          paymentStatus: 'PENDING',
          paymentAmount: order.total_price,
          pickupAt: order.pickup_at,
        },
      ]);
      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      ).resolves.toMatchObject({
        status: 'PENDING_PAYMENT',
        submitted_at: null,
      });
      expect(await prisma.outbox.count()).toBe(0);
    });

    it('호출 tx가 먼저 스냅샷을 만들었어도 그사이 커밋된 확인을 보고 다시 확인하지 않는다', async () => {
      const order = await createOrder(prisma, {
        status: 'PENDING_PAYMENT',
        pickup_at: new Date(NOW.getTime() + 48 * 60 * 60_000),
      });
      await createPayment(prisma, { order_id: order.id, amount: 10_000 });
      const args = await confirmArgs(order.id);
      let snapshotTaken!: () => void;
      const snapshot = new Promise<void>(
        (resolve) => (snapshotTaken = resolve),
      );
      let proceed!: () => void;
      const gate = new Promise<void>((resolve) => (proceed = resolve));

      const auto = prisma.$transaction(
        async (tx) => {
          await tx.payment.count();
          snapshotTaken();
          await gate;
          return repo.confirmPaymentLocked(tx, {
            ...args,
            source: 'AUTO',
            assertConfirmable: (state) =>
              assertPaymentConfirmable(state, args.depositedAmount, NOW),
          });
        },
        { timeout: 20_000 },
      );
      await snapshot;
      try {
        await repo.confirmPayment(args);
      } finally {
        proceed();
      }

      await expect(auto).rejects.toThrowDomain('PAYMENT_NOT_PENDING');
      expect(
        await prisma.orderStatusHistory.count({
          where: { order_id: order.id },
        }),
      ).toBe(1);
      await expect(
        prisma.payment.findUniqueOrThrow({ where: { order_id: order.id } }),
      ).resolves.toMatchObject({ confirm_source: 'ADMIN' });
    });
  });
  describe('cancel', () => {
    const policy = new OrderCancelPolicy();
    const PAID = 30_000;

    async function paidOrder(
      status: OrderStatus,
      opts: { confirmed?: boolean; commissionRateBps?: number } = {},
    ) {
      const order = await createOrder(prisma, {
        status,
        total_price: PAID,
        commission_rate_bps: opts.commissionRateBps ?? 0,
      });
      const item = await createOrderItem(prisma, { order_id: order.id });
      const confirmed = opts.confirmed ?? status !== 'PENDING_PAYMENT';
      const payment = await createPayment(prisma, {
        order_id: order.id,
        status: confirmed ? 'CONFIRMED' : 'PENDING',
        confirmed_at: confirmed ? NOW : null,
      });
      return { order, item, payment };
    }

    function cancelArgs(
      orderId: bigint,
      request: Partial<OrderCancelRequest> = {},
      overrides: Partial<CancelOrderArgs> = {},
    ): CancelOrderArgs {
      return {
        orderId,
        actor: 'ADMIN',
        actorAccountId: 1n,
        scope: { kind: 'any' },
        note: null,
        now: NOW,
        decide: (state) =>
          policy.decide({ actor: 'ADMIN', reason: 'OTHER', ...request }, state),
        ...overrides,
      };
    }

    it('입금 대기 취소는 결제를 CANCELED로 닫고 환불·정산 없이 이력·이벤트를 남긴다', async () => {
      const { order, payment } = await paidOrder('PENDING_PAYMENT');

      await repo.cancel(
        cancelArgs(order.id, { reason: 'PAYMENT_NOT_RECEIVED' }),
      );

      await expect(
        prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
      ).resolves.toMatchObject({ status: 'CANCELED', canceled_at: NOW });
      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      ).resolves.toMatchObject({
        status: 'CANCELED',
        canceled_at: NOW,
        settlement_finalized_at: null,
      });
      await expect(
        prisma.orderStatusHistory.findFirstOrThrow({
          where: { order_id: order.id },
        }),
      ).resolves.toMatchObject({
        from_status: 'PENDING_PAYMENT',
        to_status: 'CANCELED',
        actor_type: 'ADMIN',
        cancel_reason: 'PAYMENT_NOT_RECEIVED',
        cancel_fault: null,
        refund_amount: 0,
      });
      expect(await prisma.refund.count()).toBe(0);
      const events = await prisma.outbox.findMany();
      expect(events.map((e) => e.event_type)).toEqual([ORDER_STATUS_CHANGED]);
      expect(events[0].payload_json).toMatchObject({
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CANCELED',
        actorType: 'ADMIN',
        cancelReason: 'PAYMENT_NOT_RECEIVED',
        refundAmount: 0,
        pickupAt: order.pickup_at.toISOString(),
      });
    });

    it('접수 취소는 확인된 결제를 그대로 두고 결제액 전액 환불(계좌 입력 대기)과 환불 이벤트를 남긴다', async () => {
      const { order, item, payment } = await paidOrder('SUBMITTED');

      await repo.cancel(cancelArgs(order.id));

      await expect(
        prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
      ).resolves.toMatchObject({ status: 'CONFIRMED', canceled_at: null });
      const refund = await prisma.refund.findFirstOrThrow();
      expect(refund).toMatchObject({
        order_id: order.id,
        kind: 'CANCEL',
        cancel_order_id: order.id,
        amount: PAID,
        status: 'AWAITING_ACCOUNT',
        requested_at: NOW,
        account_number_enc: null,
      });
      const events = await prisma.outbox.findMany({ orderBy: { id: 'asc' } });
      expect(events.map((e) => e.event_type)).toEqual([
        ORDER_STATUS_CHANGED,
        REFUND_REQUESTED,
      ]);
      expect(events[1]).toMatchObject({
        aggregate_type: 'order',
        aggregate_id: order.id.toString(),
        payload_json: {
          refundId: refund.id.toString(),
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          buyerAccountId: order.account_id.toString(),
          kind: 'CANCEL',
          amount: PAID,
          storeId: item.store_id.toString(),
          productId: item.product_id.toString(),
          productName: 'Product snapshot',
        },
      });
      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      ).resolves.toMatchObject({ settlement_finalized_at: null });
    });

    it.each([
      // [사정, 환불액, 기대 환불, 정산 기준액]
      ['SELLER', null, PAID, null],
      ['BUYER', 0, null, PAID],
      ['BUYER', 10_001, 10_001, PAID - 10_001],
      ['BUYER', PAID, PAID, null],
    ] as const)(
      '확정 뒤 %s 사정 R=%s: 환불 %s, 남는 금액 %s를 취소 시각에 정산 확정한다',
      async (fault, refundAmount, refund, base) => {
        const { order } = await paidOrder('CONFIRMED', {
          commissionRateBps: 333,
        });

        await repo.cancel(cancelArgs(order.id, { fault, refundAmount }));

        const refunds = await prisma.refund.findMany();
        expect(refunds.map((r) => r.amount)).toEqual(
          refund === null ? [] : [refund],
        );
        const row = await prisma.order.findUniqueOrThrow({
          where: { id: order.id },
        });
        expect(row).toMatchObject(
          base === null
            ? {
                settlement_base_amount: null,
                commission_amount: null,
                settlement_finalized_at: null,
              }
            : {
                settlement_base_amount: base,
                commission_amount: Math.floor((base * 333) / 10_000),
                settlement_finalized_at: NOW,
                settlement_id: null,
              },
        );
        await expect(
          prisma.orderStatusHistory.findFirstOrThrow({
            where: { order_id: order.id },
          }),
        ).resolves.toMatchObject({
          cancel_fault: fault,
          refund_amount: refund ?? 0,
        });
      },
    );

    it('판정에는 잠금 시점 상태와 확인된 결제액만 넘기고(미확인 결제는 0), 던지면 아무것도 남지 않는다', async () => {
      const confirmed = await paidOrder('MADE');
      const unconfirmed = await paidOrder('SUBMITTED', { confirmed: false });
      const legacy = await createOrder(prisma, { status: 'CONFIRMED' });
      const seen: unknown[] = [];
      const reject = (): OrderCancelDecision => {
        throw new Error('거절');
      };

      for (const id of [confirmed.order.id, unconfirmed.order.id, legacy.id]) {
        await expect(
          repo.cancel(
            cancelArgs(
              id,
              {},
              {
                decide: (state) => {
                  seen.push(state);
                  return reject();
                },
              },
            ),
          ),
        ).rejects.toThrow('거절');
      }

      expect(seen).toEqual([
        { status: 'MADE', paidAmount: PAID },
        { status: 'SUBMITTED', paidAmount: 0 },
        { status: 'CONFIRMED', paidAmount: 0 },
      ]);
      expect(await prisma.order.count({ where: { status: 'CANCELED' } })).toBe(
        0,
      );
      expect(await prisma.orderStatusHistory.count()).toBe(0);
      expect(
        await prisma.payment.count({ where: { status: 'CANCELED' } }),
      ).toBe(0);
      expect(await prisma.outbox.count()).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('범위 밖 주문은 null이다: 다른 구매자, 입금 전·다른 매장·품목 삭제(판매자), 삭제된 주문', async () => {
      const { order, item } = await paidOrder('SUBMITTED');
      const pending = await paidOrder('PENDING_PAYMENT');
      const itemDeleted = await paidOrder('SUBMITTED');
      await prisma.orderItem.update({
        where: { id: itemDeleted.item.id },
        data: { deleted_at: NOW },
      });
      const deleted = await createOrder(prisma, { deleted_at: new Date() });

      for (const [id, scope] of [
        [order.id, { kind: 'buyer', accountId: order.account_id + 1n }],
        [order.id, { kind: 'store', storeId: item.store_id + 1n }],
        [pending.order.id, { kind: 'store', storeId: pending.item.store_id }],
        [
          itemDeleted.order.id,
          { kind: 'store', storeId: itemDeleted.item.store_id },
        ],
        [deleted.id, { kind: 'any' }],
      ] as const) {
        await expect(
          repo.cancel(cancelArgs(id, {}, { scope })),
        ).resolves.toBeNull();
      }
      expect(await prisma.orderStatusHistory.count()).toBe(0);

      await expect(
        repo.cancel(
          cancelArgs(
            order.id,
            {},
            { scope: { kind: 'buyer', accountId: order.account_id } },
          ),
        ),
      ).resolves.toMatchObject({ status: 'CANCELED' });
    });

    it('감사는 처리자가 있을 때만, 매장은 판매자에게 보이는(접수된) 주문만 남긴다', async () => {
      const submitted = await paidOrder('SUBMITTED');
      const pending = await paidOrder('PENDING_PAYMENT');
      const system = await paidOrder('PENDING_PAYMENT');

      await repo.cancel(cancelArgs(submitted.order.id, {}, { note: '메모' }));
      await repo.cancel(cancelArgs(pending.order.id));
      await repo.cancel(
        cancelArgs(
          system.order.id,
          {},
          {
            actor: 'SYSTEM',
            actorAccountId: null,
            decide: (state) =>
              policy.decide(
                { actor: 'SYSTEM', reason: 'PAYMENT_NOT_RECEIVED' },
                state,
              ),
          },
        ),
      );

      const audits = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
      expect(audits).toHaveLength(2);
      expect(audits[0]).toMatchObject({
        target_id: submitted.order.id,
        store_id: submitted.item.store_id,
        action: 'STATUS_CHANGE',
        before_json: { status: 'SUBMITTED' },
        after_json: {
          status: 'CANCELED',
          actorType: 'ADMIN',
          reason: 'OTHER',
          fault: null,
          refundAmount: PAID,
          note: '메모',
        },
      });
      expect(audits[1]).toMatchObject({
        target_id: pending.order.id,
        store_id: null,
      });
      await expect(
        prisma.orderStatusHistory.findFirstOrThrow({
          where: { order_id: system.order.id },
        }),
      ).resolves.toMatchObject({
        actor_type: 'SYSTEM',
        actor_account_id: null,
      });
      const systemEvent = await prisma.outbox.findFirstOrThrow({
        where: { aggregate_id: system.order.id.toString() },
      });
      expect(systemEvent.actor_account_id).toBeNull();
    });

    // 판매자는 입금 대기 주문이 범위 밖이라 표에서 뺀다(범위 밖 테스트)
    it.each([
      ['BUYER', 'PENDING_PAYMENT', '매장 없이 남긴다'],
      ['BUYER', 'SUBMITTED', '매장 없이 남긴다'],
      ['SELLER', 'SUBMITTED', '매장과 함께 남긴다'],
      ['ADMIN', 'PENDING_PAYMENT', '매장 없이 남긴다'],
      ['ADMIN', 'SUBMITTED', '매장과 함께 남긴다'],
      ['SYSTEM', 'PENDING_PAYMENT', '남기지 않는다'],
      ['SYSTEM', 'SUBMITTED', '남기지 않는다'],
    ] as const)(
      '%s의 %s 취소 감사는 %s — 같은 매장 다른 판매자의 감사 목록에는 매장이 있을 때만 보인다',
      async (actor, status, audit) => {
        const { order, item } = await paidOrder(status);
        const actorAccountId =
          actor === 'SYSTEM'
            ? null
            : actor === 'BUYER'
              ? order.account_id
              : (await createAccount(prisma, { account_type: actor })).id;
        const scope: OrderCancelScope =
          actor === 'BUYER'
            ? { kind: 'buyer', accountId: order.account_id }
            : actor === 'SELLER'
              ? { kind: 'store', storeId: item.store_id }
              : { kind: 'any' };

        await requestContextStorage.run(
          { clientIp: '203.0.113.77', userAgent: 'buyer-phone' },
          () =>
            repo.cancel(
              cancelArgs(
                order.id,
                {},
                {
                  actor,
                  actorAccountId,
                  scope,
                  decide: () => ({
                    reason: 'OTHER',
                    fault: null,
                    refundAmount: 0,
                  }),
                },
              ),
            ),
        );

        const audits = await prisma.auditLog.findMany();
        expect(
          audits.map((a) => ({
            actor: a.actor_account_id,
            store: a.store_id,
          })),
        ).toEqual(
          audit === '남기지 않는다'
            ? []
            : [
                {
                  actor: actorAccountId,
                  store: audit === '매장과 함께 남긴다' ? item.store_id : null,
                },
              ],
        );
        const otherSeller = await createAccount(prisma, {
          account_type: 'SELLER',
        });
        await expect(
          auditLogs.listAuditLogsBySeller({
            sellerAccountId: otherSeller.id,
            storeId: item.store_id,
            limit: 10,
          }),
        ).resolves.toHaveLength(audit === '매장과 함께 남긴다' ? 1 : 0);
      },
    );

    it('동시에 두 번 취소해도 하나만 성공하고 환불은 1건이다', async () => {
      const { order } = await paidOrder('SUBMITTED');

      const results = await Promise.allSettled([
        repo.cancel(cancelArgs(order.id)),
        repo.cancel(cancelArgs(order.id)),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const rejected = results.find((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toMatchObject({
        code: 'ORDER_NOT_CANCELLABLE',
      });
      expect(await prisma.refund.count()).toBe(1);
      expect(await prisma.orderStatusHistory.count()).toBe(1);
    });

    // 정책을 거치지 않는 경로가 생겨도 주문당 취소 환불은 DB가 1건으로 막는다
    it('반증: 같은 주문의 취소 환불(cancel_order_id)은 두 번째 행이 unique로 거절되고, 입금 반환은 NULL이라 여러 건이 공존한다', async () => {
      const { order } = await paidOrder('SUBMITTED');
      await repo.cancel(cancelArgs(order.id));
      const base = {
        order_id: order.id,
        amount: 1_000,
        requested_at: NOW,
      };

      await expect(
        prisma.refund.create({
          data: { ...base, kind: 'CANCEL', cancel_order_id: order.id },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await prisma.refund.createMany({
        data: [
          { ...base, kind: 'DEPOSIT_RETURN' },
          { ...base, kind: 'DEPOSIT_RETURN' },
        ],
      });
      expect(await prisma.refund.count({ where: { order_id: order.id } })).toBe(
        3,
      );
    });
  });
});
