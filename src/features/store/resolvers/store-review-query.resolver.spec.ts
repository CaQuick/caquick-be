import type { PrismaClient } from '@prisma/client';

import { StoreReviewRepository } from '@/features/store/repositories/store-review.repository';
import { StoreReviewQueryResolver } from '@/features/store/resolvers/store-review-query.resolver';
import { StoreReviewService } from '@/features/store/services/store-review.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createReview,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 분기/집계 세부 검증은 service.spec.ts에서 담당.
 */
describe('Store Review Query Resolver (real DB)', () => {
  let resolver: StoreReviewQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreReviewQueryResolver,
        StoreReviewService,
        StoreReviewRepository,
      ],
    });
    resolver = module.get(StoreReviewQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function makeReview(storeId: bigint) {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const order = await createOrder(prisma, { account_id: account.id });
    const orderItem = await createOrderItem(prisma, {
      order_id: order.id,
      store_id: storeId,
    });
    return createReview(prisma, { order_item_id: orderItem.id, rating: 5 });
  }

  it('storeReviews: 비로그인 사용자에게 목록·totalCount를 반환한다', async () => {
    const store = await createStore(prisma);
    await makeReview(store.id);

    const result = await resolver.storeReviews(
      { storeId: store.id.toString() },
      undefined,
    );

    expect(result.totalCount).toBe(1);
    expect(result.items[0].isLiked).toBe(false);
  });

  it('storeReviews: 로그인 사용자(JwtUser)의 좋아요 여부를 채운다', async () => {
    const store = await createStore(prisma);
    const review = await makeReview(store.id);
    const liker = await createAccount(prisma, { account_type: 'USER' });
    await prisma.reviewLike.create({
      data: { review_id: review.id, account_id: liker.id },
    });

    const result = await resolver.storeReviews(
      { storeId: store.id.toString() },
      { accountId: liker.id.toString() },
    );

    expect(result.items[0].isLiked).toBe(true);
    expect(result.items[0].likeCount).toBe(1);
  });
});
