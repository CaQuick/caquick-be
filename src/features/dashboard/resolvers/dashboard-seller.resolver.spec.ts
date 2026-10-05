import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { SellerDashboardQueryResolver } from '@/features/dashboard/resolvers/dashboard-seller-query.resolver';
import { SellerDashboardService } from '@/features/dashboard/services/dashboard-seller.service';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { bookedQuantityProviders } from '@/test/booked-quantity';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

// 분기·집계 세부 검증은 dashboard-seller.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.
describe('Seller Dashboard Resolver (real DB)', () => {
  let resolver: SellerDashboardQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerDashboardQueryResolver,
        SellerDashboardService,
        StoreSellerRepository,
        OrderRepository,
        ProductRepository,
        ConversationRepository,
        ClockService,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        ...bookedQuantityProviders(),
        // 발행 repository가 OutboxPublisher를 주입받는다(08b)
        ...outboxPublisherProviders(),
      ],
    });
    resolver = module.get(SellerDashboardQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Query.sellerDashboard 경로(input 생략)', async () => {
    const { account, store } = await setupSellerWithStore(prisma);
    await createProduct(prisma, { store_id: store.id });

    const result = await resolver.sellerDashboard({
      accountId: account.id.toString(),
      accountType: 'SELLER',
    });
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.activeProductCount).toBe(1);
    expect(result.capacity).toBeNull();
  });
});
