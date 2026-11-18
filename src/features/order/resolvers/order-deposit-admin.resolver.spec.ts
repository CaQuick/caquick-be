// 분기/검증 세부는 order-deposit-admin.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { PubSub } from 'graphql-subscriptions';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
import { PaymentRepository } from '@/features/order/repositories/payment.repository';
import { RefundRepository } from '@/features/order/repositories/refund.repository';
import { AdminDepositMutationResolver } from '@/features/order/resolvers/order-deposit-admin-mutation.resolver';
import { AdminDepositQueryResolver } from '@/features/order/resolvers/order-deposit-admin-query.resolver';
import { AdminDepositService } from '@/features/order/services/order-deposit-admin.service';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import type { PrismaClient } from '@/generated/prisma/client';
import type { JwtUser } from '@/global/auth';
import { PUB_SUB } from '@/global/pubsub';
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

describe('Admin Deposit Resolvers (real DB)', () => {
  let queryResolver: AdminDepositQueryResolver;
  let mutationResolver: AdminDepositMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminDepositQueryResolver,
        AdminDepositMutationResolver,
        AdminDepositService,
        AccountAdminRepository,
        PaymentRepository,
        OrderTransitionRepository,
        RefundRepository,
        OrderEventsService,
        { provide: PUB_SUB, useValue: new PubSub() },
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        ...outboxPublisherProviders(),
      ],
    });
    queryResolver = module.get(AdminDepositQueryResolver);
    mutationResolver = module.get(AdminDepositMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('입금 대기 목록·건수를 조회하고 ID 문자열로 입금 확인한다', async () => {
    const admin = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = { accountId: admin.id.toString() } as JwtUser;
    const order = await createOrder(prisma, {
      status: 'PENDING_PAYMENT',
      pickup_at: new Date(Date.now() + 2 * 24 * 60 * 60_000),
    });
    await createOrderItem(prisma, { order_id: order.id });
    await createPayment(prisma, { order_id: order.id });

    const list = await queryResolver.adminPendingPayments(user, {});
    expect(list.items.map((i) => i.orderId)).toEqual([order.id.toString()]);
    await expect(queryResolver.adminTaskCounts(user)).resolves.toEqual({
      claimedPayments: 0,
      pendingPayments: 1,
      refundsAwaitingAccount: 0,
      refundsAwaitingTransfer: 0,
    });

    const confirmed = await mutationResolver.adminConfirmPayment(user, {
      orderId: order.id.toString(),
      depositedAmount: order.total_price,
    });
    expect(confirmed).toMatchObject({
      id: order.id.toString(),
      status: 'SUBMITTED',
    });
  });
});
