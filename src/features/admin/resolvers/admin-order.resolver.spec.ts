// 분기/검증 세부는 admin-order.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminOrderMutationResolver } from '@/features/admin/resolvers/admin-order-mutation.resolver';
import { AdminOrderQueryResolver } from '@/features/admin/resolvers/admin-order-query.resolver';
import { AdminOrderService } from '@/features/admin/services/admin-order.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { OrderRepository, OrderStatusTransitionPolicy } from '@/features/order';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrderItem,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Admin Order Resolvers (real DB)', () => {
  let queryResolver: AdminOrderQueryResolver;
  let mutationResolver: AdminOrderMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminOrderQueryResolver,
        AdminOrderMutationResolver,
        AdminOrderService,
        AdminRepository,
        OrderRepository,
        OrderStatusTransitionPolicy,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    queryResolver = module.get(AdminOrderQueryResolver);
    mutationResolver = module.get(AdminOrderMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('목록 → 상세 → 강제 취소 경로', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = {
      accountId: actor.id.toString(),
      accountType: 'ADMIN' as const,
    };
    const item = await createOrderItem(prisma);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: item.order_id },
    });
    await createUserProfile(prisma, { account_id: order.account_id });

    const list = await queryResolver.adminOrders(user);
    expect(list.totalCount).toBe(1);

    const detail = await queryResolver.adminOrder(user, order.id.toString());
    expect(detail.items).toHaveLength(1);

    const canceled = await mutationResolver.adminCancelOrder(user, {
      orderId: order.id.toString(),
      note: '운영 판단',
    });
    expect(canceled.status).toBe('CANCELED');
  });
});
