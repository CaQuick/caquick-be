// 분기/검증 세부는 search-admin.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { SearchAdminRepository } from '@/features/search/repositories/search-admin.repository';
import { AdminSearchKeywordChipMutationResolver } from '@/features/search/resolvers/search-admin-mutation.resolver';
import { AdminSearchKeywordChipQueryResolver } from '@/features/search/resolvers/search-admin-query.resolver';
import { AdminSearchKeywordChipService } from '@/features/search/services/search-admin.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Admin Search Keyword Chip Resolvers (real DB)', () => {
  let queryResolver: AdminSearchKeywordChipQueryResolver;
  let mutationResolver: AdminSearchKeywordChipMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminSearchKeywordChipQueryResolver,
        AdminSearchKeywordChipMutationResolver,
        AdminSearchKeywordChipService,
        SearchAdminRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    queryResolver = module.get(AdminSearchKeywordChipQueryResolver);
    mutationResolver = module.get(AdminSearchKeywordChipMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('생성 → 수정 → 순서 변경 → 목록 → 삭제 경로', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = {
      accountId: actor.id.toString(),
      accountType: 'ADMIN' as const,
    };

    const christmas = await mutationResolver.adminCreateSearchKeywordChip(
      user,
      { keyword: '크리스마스' },
    );
    const newYear = await mutationResolver.adminCreateSearchKeywordChip(user, {
      keyword: '신년',
    });
    await mutationResolver.adminUpdateSearchKeywordChip(user, {
      chipId: newYear.id,
      isActive: false,
    });
    await mutationResolver.adminReorderSearchKeywordChips(user, {
      chipIds: [newYear.id, christmas.id],
    });

    const list = await queryResolver.adminSearchKeywordChips(user);
    expect(list.map((c) => [c.keyword, c.sortOrder, c.isActive])).toEqual([
      ['신년', 0, false],
      ['크리스마스', 1, true],
    ]);
    expect(
      await mutationResolver.adminDeleteSearchKeywordChip(user, christmas.id),
    ).toBe(true);
    expect(await queryResolver.adminSearchKeywordChips(user)).toHaveLength(1);
  });
});
