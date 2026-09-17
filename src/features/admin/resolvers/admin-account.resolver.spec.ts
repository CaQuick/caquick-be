// 분기/집계 세부 검증은 service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminAccountMutationResolver } from '@/features/admin/resolvers/admin-account-mutation.resolver';
import { AdminAccountQueryResolver } from '@/features/admin/resolvers/admin-account-query.resolver';
import { AdminAccountService } from '@/features/admin/services/admin-account.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccountCredential } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Admin Account Resolvers (real DB)', () => {
  let queryResolver: AdminAccountQueryResolver;
  let mutationResolver: AdminAccountMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminAccountQueryResolver,
        AdminAccountMutationResolver,
        AdminAccountService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    queryResolver = module.get(AdminAccountQueryResolver);
    mutationResolver = module.get(AdminAccountMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Query.adminMe: 본인 관리자 계정을 반환한다', async () => {
    const credential = await createAccountCredential(prisma, {
      account_type: 'ADMIN',
      username: 'me.admin',
    });

    const result = await queryResolver.adminMe({
      accountId: credential.account_id.toString(),
      accountType: 'ADMIN',
    });

    expect(result.accountId).toBe(credential.account_id.toString());
    expect(result.username).toBe('me.admin');
  });

  it('Mutation.adminCreateAdmin → Query.adminAdmins: 생성한 계정이 목록에 나타난다', async () => {
    const credential = await createAccountCredential(prisma, {
      account_type: 'ADMIN',
    });
    const user = {
      accountId: credential.account_id.toString(),
      accountType: 'ADMIN' as const,
    };

    const created = await mutationResolver.adminCreateAdmin(user, {
      username: 'second.admin',
      password: 'Strong!Pass1',
    });
    const list = await queryResolver.adminAdmins(user, { limit: 10 });

    expect(list.totalCount).toBe(2);
    expect(list.items[0].accountId).toBe(created.accountId);
  });
});
