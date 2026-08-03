import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductReviewRepository } from '@/features/product/repositories/product-review.repository';
import { ProductReviewQueryResolver } from '@/features/product/resolvers/product-review-query.resolver';
import { ProductReviewService } from '@/features/product/services/product-review.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrderItem,
  createProduct,
  createReview,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 분기/필터 세부 검증은 service.spec.ts에서 담당.
 */
describe('ProductReview Query Resolver (real DB)', () => {
  let resolver: ProductReviewQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ProductReviewQueryResolver,
        ProductReviewService,
        ProductReviewRepository,
      ],
    });
    resolver = module.get(ProductReviewQueryResolver);
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

  it('reviewDetail: 로그인 사용자(JwtUser)의 isLiked를 채운다', async () => {
    const product = await createProduct(prisma);
    const orderItem = await createOrderItem(prisma, { product_id: product.id });
    const review = await createReview(prisma, { order_item_id: orderItem.id });
    const liker = await createAccount(prisma, { account_type: 'USER' });
    await prisma.reviewLike.create({
      data: { review_id: review.id, account_id: liker.id },
    });

    const result = await resolver.reviewDetail(review.id.toString(), {
      accountId: liker.id.toString(),
    });

    expect(result.review.isLiked).toBe(true);
    expect(result.review.likeCount).toBe(1);
    expect(result.product.productId).toBe(product.id.toString());
  });

  it('productReviews: 로그인 사용자(JwtUser)의 isLiked를 채운다', async () => {
    const product = await createProduct(prisma);
    const orderItem = await createOrderItem(prisma, { product_id: product.id });
    const review = await createReview(prisma, { order_item_id: orderItem.id });
    const liker = await createAccount(prisma, { account_type: 'USER' });
    await prisma.reviewLike.create({
      data: { review_id: review.id, account_id: liker.id },
    });

    const result = await resolver.productReviews(
      { productId: product.id.toString() },
      { accountId: liker.id.toString() },
    );

    expect(result.items[0].isLiked).toBe(true);
  });

  it('reviewDetail: 비로그인 사용자는 isLiked=false', async () => {
    const product = await createProduct(prisma);
    const orderItem = await createOrderItem(prisma, { product_id: product.id });
    const review = await createReview(prisma, { order_item_id: orderItem.id });

    const result = await resolver.reviewDetail(review.id.toString(), undefined);

    expect(result.review.isLiked).toBe(false);
  });

  it('reviewComments: 로그인 사용자(JwtUser)의 isMine을 채운다', async () => {
    const product = await createProduct(prisma);
    const orderItem = await createOrderItem(prisma, { product_id: product.id });
    const review = await createReview(prisma, { order_item_id: orderItem.id });
    const commenter = await createAccount(prisma, { account_type: 'USER' });
    await prisma.reviewComment.create({
      data: {
        review_id: review.id,
        account_id: commenter.id,
        content: '내 댓글',
      },
    });

    const result = await resolver.reviewComments(
      { reviewId: review.id.toString() },
      { accountId: commenter.id.toString() },
    );

    expect(result.items[0].isMine).toBe(true);
  });

  it('reviewComments: 없는 리뷰는 NotFoundException', async () => {
    await expect(
      resolver.reviewComments({ reviewId: '999999' }, undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
