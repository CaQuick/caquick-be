import { ReviewReadRepository } from '@/features/review/repositories/review-read.repository';
import { ReviewListingQueryResolver } from '@/features/review/resolvers/review-listing-query.resolver';
import { ReviewListingService } from '@/features/review/services/review-listing.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrderItem,
  createProduct,
  createReview,
  createReviewLike,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 분기/집계 세부 검증은 service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.
describe('ReviewListing Query Resolver (real DB)', () => {
  let resolver: ReviewListingQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ReviewListingQueryResolver,
        ReviewListingService,
        ReviewReadRepository,
      ],
    });
    resolver = module.get(ReviewListingQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('productReviews: 비로그인 사용자에게 리뷰 목록을 반환한다', async () => {
    const product = await createProduct(prisma);
    const orderItem = await createOrderItem(prisma, { product_id: product.id });
    const review = await createReview(prisma, { order_item_id: orderItem.id });

    const result = await resolver.productReviews(
      { productId: product.id.toString() },
      undefined,
    );

    expect(result.items.map((r) => r.id)).toEqual([review.id.toString()]);
    expect(result.totalCount).toBe(1);
    expect(result.items[0].isLiked).toBe(false);
  });

  it('storeReviews: 로그인 사용자(JwtUser)의 좋아요 여부와 sort=LIKES를 전달한다', async () => {
    const store = await createStore(prisma);
    const unpopular = await createReview(prisma, {
      order_item_id: (await createOrderItem(prisma, { store_id: store.id })).id,
    });
    const popular = await createReview(prisma, {
      order_item_id: (await createOrderItem(prisma, { store_id: store.id })).id,
    });
    const liker = await createAccount(prisma, { account_type: 'USER' });
    await createReviewLike(prisma, {
      review_id: popular.id,
      account_id: liker.id,
    });

    const result = await resolver.storeReviews(
      { storeId: store.id.toString(), sort: 'LIKES' },
      { accountId: liker.id.toString() },
    );

    expect(result.items.map((r) => r.id)).toEqual([
      popular.id.toString(),
      unpopular.id.toString(),
    ]);
    expect(result.items[0].isLiked).toBe(true);
    expect(result.items[0].likeCount).toBe(1);
  });
});
