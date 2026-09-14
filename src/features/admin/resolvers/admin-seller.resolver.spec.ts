// 분기/검증 세부는 admin-seller.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminSellerMutationResolver } from '@/features/admin/resolvers/admin-seller-mutation.resolver';
import { AdminSellerQueryResolver } from '@/features/admin/resolvers/admin-seller-query.resolver';
import { AdminSellerService } from '@/features/admin/services/admin-seller.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Admin Seller Resolvers (real DB)', () => {
  let queryResolver: AdminSellerQueryResolver;
  let mutationResolver: AdminSellerMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminSellerQueryResolver,
        AdminSellerMutationResolver,
        AdminSellerService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    queryResolver = module.get(AdminSellerQueryResolver);
    mutationResolver = module.get(AdminSellerMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('온보딩 → 목록 → 단건 → 비밀번호 초기화 경로', async () => {
    const account = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = {
      accountId: account.id.toString(),
      accountType: 'ADMIN' as const,
    };

    const created = await mutationResolver.adminCreateSeller(user, {
      username: 'shop.owner',
      password: 'Strong!Pass1',
      businessName: '상호',
      businessPhone: '02-0000-0000',
      store: {
        storeName: '매장',
        storePhone: '02-0000-0001',
        addressFull: '서울 어딘가',
      },
    });
    const list = await queryResolver.adminSellers(user, { keyword: 'shop.ow' });
    expect(list.totalCount).toBe(1);

    const detail = await queryResolver.adminSeller(user, created.accountId);
    expect(detail.store?.storeName).toBe('매장');

    expect(
      await mutationResolver.adminResetSellerPassword(user, {
        accountId: created.accountId,
        newPassword: 'Reset!Pass9',
      }),
    ).toBe(true);
  });
});
