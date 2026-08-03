import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserEngagementMutationResolver } from '@/features/user/resolvers/user-engagement-mutation.resolver';
import { UserEngagementService } from '@/features/user/services/user-engagement.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createReview,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('User Engagement Resolver (real DB)', () => {
  let resolver: UserEngagementMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserEngagementMutationResolver,
        UserEngagementService,
        UserRepository,
      ],
    });
    resolver = module.get(UserEngagementMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('likeReview는 DB에 ReviewLike를 생성하고 true를 반환한다', async () => {
    const review = await createReview(prisma);
    const liker = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: liker.id });

    const ok = await resolver.likeReview(
      { accountId: liker.id.toString() },
      review.id.toString(),
    );

    expect(ok).toBe(true);
    const count = await prisma.reviewLike.count({
      where: { review_id: review.id, account_id: liker.id },
    });
    expect(count).toBe(1);
  });

  it('자기 리뷰 좋아요는 BadRequestException이 전파된다', async () => {
    const review = await createReview(prisma);
    await createUserProfile(prisma, { account_id: review.account_id });

    await expect(
      resolver.likeReview(
        { accountId: review.account_id.toString() },
        review.id.toString(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('unlikeReview는 좋아요를 soft-delete하고 true를 반환한다', async () => {
    const review = await createReview(prisma);
    const liker = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: liker.id });
    await resolver.likeReview(
      { accountId: liker.id.toString() },
      review.id.toString(),
    );

    const ok = await resolver.unlikeReview(
      { accountId: liker.id.toString() },
      review.id.toString(),
    );

    expect(ok).toBe(true);
    const activeLikes = await prisma.reviewLike.count({
      where: { review_id: review.id, account_id: liker.id, deleted_at: null },
    });
    expect(activeLikes).toBe(0);
  });

  it('writeReviewComment는 댓글을 생성하고 deleteMyReviewComment로 삭제된다', async () => {
    const review = await createReview(prisma);
    const commenter = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: commenter.id });
    const jwtUser = { accountId: commenter.id.toString() };

    const created = await resolver.writeReviewComment(jwtUser, {
      reviewId: review.id.toString(),
      content: '너무 귀여워요',
    });
    expect(created.content).toBe('너무 귀여워요');

    const deleted = await resolver.deleteMyReviewComment(jwtUser, created.id);
    expect(deleted).toBe(true);

    const activeComments = await prisma.reviewComment.count({
      where: { review_id: review.id, deleted_at: null },
    });
    expect(activeComments).toBe(0);
  });
});
