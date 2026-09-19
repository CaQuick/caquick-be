// 분기/검증 세부는 admin-moderation.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminModerationMutationResolver } from '@/features/admin/resolvers/admin-moderation-mutation.resolver';
import { AdminModerationQueryResolver } from '@/features/admin/resolvers/admin-moderation-query.resolver';
import { AdminModerationService } from '@/features/admin/services/admin-moderation.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createReviewReport } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Admin Moderation Resolvers (real DB)', () => {
  let queryResolver: AdminModerationQueryResolver;
  let mutationResolver: AdminModerationMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminModerationQueryResolver,
        AdminModerationMutationResolver,
        AdminModerationService,
        AdminRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    queryResolver = module.get(AdminModerationQueryResolver);
    mutationResolver = module.get(AdminModerationMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('신고 큐 → 상세 → 처리(DELETE_TARGET) → 리뷰 목록(삭제 포함) 경로', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = {
      accountId: actor.id.toString(),
      accountType: 'ADMIN' as const,
    };
    const report = await createReviewReport(prisma);

    const queue = await queryResolver.adminReviewReports(user);
    expect(queue.totalCount).toBe(1);

    const detail = await queryResolver.adminReviewReport(
      user,
      report.id.toString(),
    );
    expect(detail.target.deleted).toBe(false);

    const resolved = await mutationResolver.adminResolveReviewReport(user, {
      reportId: report.id.toString(),
      action: 'DELETE_TARGET',
    });
    expect(resolved.status).toBe('RESOLVED');

    const reviews = await queryResolver.adminReviews(user, {
      includeDeleted: true,
    });
    expect(reviews.items[0].deleted).toBe(true);
    expect((await queryResolver.adminReviewReports(user)).totalCount).toBe(0);
  });
});
