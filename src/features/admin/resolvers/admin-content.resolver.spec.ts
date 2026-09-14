// 분기/검증 세부는 admin-banner.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminContentMutationResolver } from '@/features/admin/resolvers/admin-content-mutation.resolver';
import { AdminContentQueryResolver } from '@/features/admin/resolvers/admin-content-query.resolver';
import { AdminBannerService } from '@/features/admin/services/admin-banner.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Admin Content Resolvers (real DB)', () => {
  let queryResolver: AdminContentQueryResolver;
  let mutationResolver: AdminContentMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminContentQueryResolver,
        AdminContentMutationResolver,
        AdminBannerService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    queryResolver = module.get(AdminContentQueryResolver);
    mutationResolver = module.get(AdminContentMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('생성 → 단건 조회 → 수정 → 목록 → 삭제 경로', async () => {
    const account = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = {
      accountId: account.id.toString(),
      accountType: 'ADMIN' as const,
    };

    const created = await mutationResolver.adminCreateBanner(user, {
      placement: 'SEARCH',
      imageUrl: 'https://i.example/search.png',
    });
    const fetched = await queryResolver.adminBanner(user, created.id);
    expect(fetched.placement).toBe('SEARCH');

    const updated = await mutationResolver.adminUpdateBanner(user, {
      bannerId: created.id,
      isActive: false,
    });
    expect(updated.isActive).toBe(false);

    const list = await queryResolver.adminBanners(user, {
      placement: 'SEARCH',
    });
    expect(list.totalCount).toBe(1);

    expect(await mutationResolver.adminDeleteBanner(user, created.id)).toBe(
      true,
    );
    const after = await queryResolver.adminBanners(user);
    expect(after.totalCount).toBe(0);
  });
});
