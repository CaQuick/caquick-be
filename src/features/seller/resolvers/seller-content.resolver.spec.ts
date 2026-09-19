// 감사 로그 목록의 전체 경로 1케이스. 분기·필터 검증은 seller-audit.service.spec.ts에서 담당
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerContentQueryResolver } from '@/features/seller/resolvers/seller-content-query.resolver';
import { SellerAuditService } from '@/features/seller/services/seller-audit.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Seller Content Resolvers (real DB)', () => {
  let queryResolver: SellerContentQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerContentQueryResolver,
        SellerAuditService,
        SellerRepository,
        StoreSellerRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    queryResolver = module.get(SellerContentQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Query.sellerAuditLogs: 기록이 없으면 빈 페이지', async () => {
    const { account } = await setupSellerWithStore(prisma);
    const result = await queryResolver.sellerAuditLogs({
      accountId: account.id.toString(),
    });
    expect(result).toMatchObject({ items: [], totalCount: 0, hasMore: false });
  });
});
