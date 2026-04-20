import type { PrismaClient } from '@prisma/client';

import { OrderRepository } from '@/features/order/repositories/order.repository';
import { RecentProductViewRepository } from '@/features/user/repositories/recent-product-view.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserMypageQueryResolver } from '@/features/user/resolvers/user-mypage-query.resolver';
import { UserMypageService } from '@/features/user/services/user-mypage.service';
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

describe('User Mypage Resolver (real DB)', () => {
  let resolver: UserMypageQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserMypageQueryResolver,
        UserMypageService,
        UserRepository,
        OrderRepository,
        RecentProductViewRepository,
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
    expect(result.counts).toMatchObject({
      customDraftCount: 0,
      couponCount: 0,
      wishlistCount: 0,
      myReviewCount: 0,
    });
  });
});
