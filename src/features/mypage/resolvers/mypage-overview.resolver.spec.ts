import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountUserRepository } from '@/features/auth/repositories/account-user.repository';
import { UserMypageQueryResolver } from '@/features/mypage/resolvers/mypage-overview-query.resolver';
import { UserMypageService } from '@/features/mypage/services/mypage-overview.service';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductCardService } from '@/features/product/services/product-card.service';
import { ReviewReadRepository } from '@/features/review';
import { RecentProductViewRepository } from '@/features/review/repositories/recent-product-view.repository';
import { ReviewEngagementRepository } from '@/features/review/repositories/review-engagement.repository';
import { WishlistRepository } from '@/features/review/repositories/wishlist.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

describe('User Mypage Resolver (real DB)', () => {
  let resolver: UserMypageQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ReviewEngagementRepository,
        WishlistRepository,
        ProductCardService,
        ReviewReadRepository,
        ProductRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        UserMypageQueryResolver,
        UserMypageService,
        AccountUserRepository,
        OrderRepository,
        RecentProductViewRepository,
        // 발행 repository가 OutboxPublisher를 주입받는다(08b)
        ...outboxPublisherProviders(),
      ],
    });
    resolver = module.get(UserMypageQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Query.myPageOverview: 진행중 주문 + 최근 본 상품을 DB에서 집계 반환', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    const store = await createStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });
    const order = await createOrder(prisma, {
      account_id: account.id,
      status: 'SUBMITTED',
    });
    await createOrderItem(prisma, {
      order_id: order.id,
      product_id: product.id,
      product_name_snapshot: '상품',
    });

    const result = await resolver.myPageOverview({
      accountId: account.id.toString(),
    });

    expect(result.ongoingOrders).toHaveLength(1);
    expect(result.ongoingOrders[0].orderId).toBe(order.id.toString());
    expect(result.counts).toEqual({
      wishlistCount: 0,
      myReviewCount: 0,
    });
  });
});
