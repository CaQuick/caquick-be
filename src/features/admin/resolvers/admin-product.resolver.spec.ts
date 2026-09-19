// 분기/검증 세부는 admin-product.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminProductMutationResolver } from '@/features/admin/resolvers/admin-product-mutation.resolver';
import { AdminProductQueryResolver } from '@/features/admin/resolvers/admin-product-query.resolver';
import { AdminProductService } from '@/features/admin/services/admin-product.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createProduct } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Admin Product Resolvers (real DB)', () => {
  let queryResolver: AdminProductQueryResolver;
  let mutationResolver: AdminProductMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminProductQueryResolver,
        AdminProductMutationResolver,
        AdminProductService,
        AdminRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    queryResolver = module.get(AdminProductQueryResolver);
    mutationResolver = module.get(AdminProductMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('목록 → 강제 비활성 → 상세 경로', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = {
      accountId: actor.id.toString(),
      accountType: 'ADMIN' as const,
    };
    const product = await createProduct(prisma, { name: '케이크' });

    const list = await queryResolver.adminProducts(user, { keyword: '케이크' });
    expect(list.totalCount).toBe(1);

    const off = await mutationResolver.adminSetProductActive(user, {
      productId: product.id.toString(),
      isActive: false,
    });
    expect(off.isActive).toBe(false);

    const detail = await queryResolver.adminProduct(
      user,
      product.id.toString(),
    );
    expect(detail.product.isActive).toBe(false);
  });
});
