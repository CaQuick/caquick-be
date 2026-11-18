import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ORDER_STATUS_CHANGED } from '@/features/order/events/order-status-changed.event';
import {
  OrderTransitionRepository,
  type ConfirmPaymentArgs,
} from '@/features/order/repositories/order-transition.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createOrder, createPayment } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

const NOW = new Date('2026-09-16T07:00:00.000Z');

describe('OrderTransitionRepository (real DB)', () => {
  let repo: OrderTransitionRepository;
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
  });
});
