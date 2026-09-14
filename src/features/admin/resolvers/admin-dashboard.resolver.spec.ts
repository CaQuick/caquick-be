// 집계 세부 검증은 admin-dashboard.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminDashboardQueryResolver } from '@/features/admin/resolvers/admin-dashboard-query.resolver';
import { AdminDashboardService } from '@/features/admin/services/admin-dashboard.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { SearchRepository } from '@/features/search';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Admin Dashboard Resolver (real DB)', () => {
  let resolver: AdminDashboardQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminDashboardQueryResolver,
        AdminDashboardService,
        AdminRepository,
        SearchRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    resolver = module.get(AdminDashboardQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Query.adminDashboardSummary / adminSearchKeywordSnapshot 경로', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = {
      accountId: actor.id.toString(),
      accountType: 'ADMIN' as const,
    };

    const summary = await resolver.adminDashboardSummary(user, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-02T00:00:00Z'),
    });
    expect(summary.newUserCount).toBe(0);

    const snapshot = await resolver.adminSearchKeywordSnapshot(user);
    expect(snapshot).toEqual({ rankedAt: null, items: [] });
  });
});
