// 분기/검증 세부는 admin-store.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.
import type { PrismaClient } from '@prisma/client';

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminStoreMutationResolver } from '@/features/admin/resolvers/admin-store-mutation.resolver';
import { AdminStoreQueryResolver } from '@/features/admin/resolvers/admin-store-query.resolver';
import { AdminStoreService } from '@/features/admin/services/admin-store.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { s3TestProviders } from '@/test/storage/s3-test.helper';

describe('Admin Store Resolvers (real DB)', () => {
  let queryResolver: AdminStoreQueryResolver;
  let mutationResolver: AdminStoreMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ...s3TestProviders(),
        AdminStoreQueryResolver,
        AdminStoreMutationResolver,
        AdminStoreService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    queryResolver = module.get(AdminStoreQueryResolver);
    mutationResolver = module.get(AdminStoreMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('목록 → 노출 끄기 → 기본정보 수정 → 상세 경로', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = {
      accountId: actor.id.toString(),
      accountType: 'ADMIN' as const,
    };
    const store = await createStore(prisma, { store_name: '가게' });

    const list = await queryResolver.adminStores(user, { keyword: '가게' });
    expect(list.totalCount).toBe(1);

    const off = await mutationResolver.adminSetStoreActive(user, {
      storeId: store.id.toString(),
      isActive: false,
    });
    expect(off.isActive).toBe(false);

    const renamed = await mutationResolver.adminUpdateStoreBasicInfo(user, {
      storeId: store.id.toString(),
      storeName: '새 가게',
    });
    expect(renamed.storeName).toBe('새 가게');

    const detail = await queryResolver.adminStore(user, store.id.toString());
    expect(detail.store.isActive).toBe(false);
    expect(detail.seller.accountId).toBe(store.seller_account_id.toString());
  });
});
