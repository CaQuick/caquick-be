// 분기/검증 세부는 admin-region.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminRegionMutationResolver } from '@/features/admin/resolvers/admin-region-mutation.resolver';
import { AdminRegionQueryResolver } from '@/features/admin/resolvers/admin-region-query.resolver';
import { AdminRegionService } from '@/features/admin/services/admin-region.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Admin Region Resolvers (real DB)', () => {
  let queryResolver: AdminRegionQueryResolver;
  let mutationResolver: AdminRegionMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminRegionQueryResolver,
        AdminRegionMutationResolver,
        AdminRegionService,
        AdminRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    queryResolver = module.get(AdminRegionQueryResolver);
    mutationResolver = module.get(AdminRegionMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('1차 생성 → 2차 생성 → 수정 → 목록 → 삭제 경로', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = {
      accountId: actor.id.toString(),
      accountType: 'ADMIN' as const,
    };

    const group = await mutationResolver.adminCreateRegion(user, {
      name: '서울',
      slug: 'seoul',
    });
    const child = await mutationResolver.adminCreateRegion(user, {
      parentId: group.id,
      name: '강남구',
      slug: 'sgg-11680',
    });
    await mutationResolver.adminUpdateRegion(user, {
      regionId: child.id,
      sortOrder: 5,
    });
    const list = await queryResolver.adminRegions(user, { parentId: group.id });
    expect(list.map((r) => r.sortOrder)).toEqual([5]);
    expect(await mutationResolver.adminDeleteRegion(user, child.id)).toBe(true);
    expect(await mutationResolver.adminDeleteRegion(user, group.id)).toBe(true);
  });
});
