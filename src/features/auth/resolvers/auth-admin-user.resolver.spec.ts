// 분기/검증 세부는 admin-user.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { AdminUserMutationResolver } from '@/features/auth/resolvers/auth-admin-user-mutation.resolver';
import { AdminUserQueryResolver } from '@/features/auth/resolvers/auth-admin-user-query.resolver';
import { AdminUserService } from '@/features/auth/services/auth-admin-user.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createUserProfile } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { NOOP_BLACKLIST_PROVIDER } from '@/test/redis';

describe('Admin User Resolvers (real DB)', () => {
  let queryResolver: AdminUserQueryResolver;
  let mutationResolver: AdminUserMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminUserQueryResolver,
        AdminUserMutationResolver,
        AdminUserService,
        NOOP_BLACKLIST_PROVIDER,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    queryResolver = module.get(AdminUserQueryResolver);
    mutationResolver = module.get(AdminUserMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('목록 → 정지 → 단건 → 복구 경로', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = {
      accountId: actor.id.toString(),
      accountType: 'ADMIN' as const,
    };
    const target = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, {
      account_id: target.id,
      nickname: 'buyer1',
    });

    const list = await queryResolver.adminUsers(user, { keyword: 'buyer' });
    expect(list.totalCount).toBe(1);

    const suspended = await mutationResolver.adminSuspendAccount(user, {
      accountId: target.id.toString(),
      reason: '테스트',
    });
    expect(suspended.status).toBe('SUSPENDED');

    const detail = await queryResolver.adminUser(user, target.id.toString());
    expect(detail.status).toBe('SUSPENDED');

    const reinstated = await mutationResolver.adminReinstateAccount(
      user,
      target.id.toString(),
    );
    expect(reinstated.status).toBe('ACTIVE');
  });
});
