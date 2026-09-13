// 분기/검증 세부는 admin-taxonomy.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.
import type { PrismaClient } from '@prisma/client';

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminTaxonomyMutationResolver } from '@/features/admin/resolvers/admin-taxonomy-mutation.resolver';
import { AdminTaxonomyQueryResolver } from '@/features/admin/resolvers/admin-taxonomy-query.resolver';
import { AdminTaxonomyService } from '@/features/admin/services/admin-taxonomy.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Admin Taxonomy Resolvers (real DB)', () => {
  let queryResolver: AdminTaxonomyQueryResolver;
  let mutationResolver: AdminTaxonomyMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminTaxonomyQueryResolver,
        AdminTaxonomyMutationResolver,
        AdminTaxonomyService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    queryResolver = module.get(AdminTaxonomyQueryResolver);
    mutationResolver = module.get(AdminTaxonomyMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('카테고리 생성→수정→목록→삭제, 태그 생성→수정→목록→삭제 경로', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = {
      accountId: actor.id.toString(),
      accountType: 'ADMIN' as const,
    };

    const category = await mutationResolver.adminCreateCategory(user, {
      categoryType: 'EVENT',
      name: '생일',
    });
    await mutationResolver.adminUpdateCategory(user, {
      categoryId: category.id,
      sortOrder: 3,
    });
    expect((await queryResolver.adminCategories(user))[0].sortOrder).toBe(3);
    expect(await mutationResolver.adminDeleteCategory(user, category.id)).toBe(
      true,
    );
    expect(await queryResolver.adminCategories(user)).toHaveLength(0);

    const tag = await mutationResolver.adminCreateTag(user, { name: '딸기' });
    await mutationResolver.adminUpdateTag(user, {
      tagId: tag.id,
      name: '생딸기',
    });
    expect((await queryResolver.adminTags(user)).items[0].name).toBe('생딸기');
    expect(await mutationResolver.adminDeleteTag(user, tag.id)).toBe(true);
    expect((await queryResolver.adminTags(user)).totalCount).toBe(0);
  });
});
