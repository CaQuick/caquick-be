import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ReviewRepository } from '@/features/user/repositories/review.repository';
import { UserReviewMutationResolver } from '@/features/user/resolvers/user-review-mutation.resolver';
import { UserReviewQueryResolver } from '@/features/user/resolvers/user-review-query.resolver';
import { UserReviewService } from '@/features/user/services/user-review.service';
import { S3Service } from '@/global/storage/s3.service';
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

const VALID_CONTENT = '맛있게 잘 먹었습니다. 다음에 또 주문할게요.';

describe('User Review Resolvers (real DB)', () => {
  let queryResolver: UserReviewQueryResolver;
  let mutationResolver: UserReviewMutationResolver;
  let prisma: PrismaClient;
  let s3Service: jest.Mocked<S3Service>;

  beforeAll(async () => {
    s3Service = {
      createUploadUrl: jest.fn(),
    } as unknown as jest.Mocked<S3Service>;

    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserReviewQueryResolver,
        UserReviewMutationResolver,
        UserReviewService,
        ReviewRepository,
        { provide: S3Service, useValue: s3Service },
      ],
    });
    queryResolver = module.get(UserReviewQueryResolver);
    mutationResolver = module.get(UserReviewMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    jest.clearAllMocks();
  });

  async function setupReviewableItem() {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    const store = await createStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });
    const order = await createOrder(prisma, {
      account_id: account.id,
      status: 'PICKED_UP',
    });
    const item = await createOrderItem(prisma, {
      order_id: order.id,
      product_id: product.id,
      product_name_snapshot: '상품',
    });
    return { accountId: account.id, orderItemId: item.id };
  }

  it('Mutation.writeReview: 유효 입력이면 DB에 Review 생성 후 DTO 반환', async () => {
    const ctx = await setupReviewableItem();

    const result = await mutationResolver.writeReview(
      { accountId: ctx.accountId.toString() },
      {
        orderItemId: ctx.orderItemId.toString(),
        rating: 5,
        content: VALID_CONTENT,
      },
    );

    expect(result.rating).toBe(5);
    const saved = await prisma.review.findUniqueOrThrow({
      where: { id: BigInt(result.reviewId) },
    });
    expect(saved.account_id).toBe(ctx.accountId);
  });

  it('Mutation.writeReview: 유효성 실패는 BadRequestException이 전파된다', async () => {
    const ctx = await setupReviewableItem();

    await expect(
      mutationResolver.writeReview(
        { accountId: ctx.accountId.toString() },
        {
          orderItemId: ctx.orderItemId.toString(),
          rating: 5,
          content: '너무짧음',
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('Query.myReviews: 본인 리뷰 목록이 DB에서 조회되어 반환된다', async () => {
    const ctx = await setupReviewableItem();
    await mutationResolver.writeReview(
      { accountId: ctx.accountId.toString() },
      {
        orderItemId: ctx.orderItemId.toString(),
        rating: 4,
        content: VALID_CONTENT,
      },
    );

    const result = await queryResolver.myReviews(
      { accountId: ctx.accountId.toString() },
      { offset: 0, limit: 10 },
    );

    expect(result.totalCount).toBe(1);
    expect(result.items[0].rating).toBe(4);
  });
});
