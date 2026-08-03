import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { NotificationEvent, NotificationType } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserEngagementService } from '@/features/user/services/user-engagement.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createReview,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('UserEngagementService (real DB)', () => {
  let service: UserEngagementService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [UserEngagementService, UserRepository],
    });

    service = module.get(UserEngagementService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('likeReview', () => {
    it('다른 유저의 리뷰에 좋아요를 누르면 ReviewLike 레코드 + 알림이 생성된다', async () => {
      // 리뷰 작성자 (author) - createReview가 OrderItem 계정을 자동 사용
      const review = await createReview(prisma);

      // 좋아요 누를 별도 유저
      const liker = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: liker.id });

      const result = await service.likeReview(liker.id, review.id);

      expect(result).toBe(true);

      const like = await prisma.reviewLike.findFirstOrThrow({
        where: { review_id: review.id, account_id: liker.id },
      });
      expect(like).toBeDefined();

      const notification = await prisma.notification.findFirstOrThrow({
        where: {
          account_id: review.account_id,
          type: NotificationType.REVIEW_LIKE,
          event: NotificationEvent.REVIEW_LIKED,
          review_id: review.id,
        },
      });
      expect(notification.title).toContain('좋아요');
    });

    it('자기 리뷰에 좋아요 시 BadRequestException이 발생하고 ReviewLike/알림이 생성되지 않는다', async () => {
      const review = await createReview(prisma);
      // 리뷰 작성자 계정에 USER 프로필을 채워 requireActiveUser 통과하도록
      await createUserProfile(prisma, { account_id: review.account_id });

      await expect(
        service.likeReview(review.account_id, review.id),
      ).rejects.toThrow(BadRequestException);

      const likeCount = await prisma.reviewLike.count({
        where: { review_id: review.id },
      });
      expect(likeCount).toBe(0);

      const notifCount = await prisma.notification.count({
        where: { review_id: review.id },
      });
      expect(notifCount).toBe(0);
    });

    it('존재하지 않는 리뷰면 NotFoundException을 던진다', async () => {
      const liker = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: liker.id });

      await expect(
        service.likeReview(liker.id, BigInt(999999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('이미 좋아요를 누른 리뷰에 다시 누르면 true를 반환하되 중복 레코드를 만들지 않는다', async () => {
      const review = await createReview(prisma);
      const liker = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: liker.id });

      await service.likeReview(liker.id, review.id);
      const second = await service.likeReview(liker.id, review.id);

      expect(second).toBe(true);
      const likeCount = await prisma.reviewLike.count({
        where: { review_id: review.id, account_id: liker.id },
      });
      expect(likeCount).toBe(1);
    });

    it('계정이 삭제된 사용자는 UnauthorizedException을 던진다 (requireActiveUser)', async () => {
      const review = await createReview(prisma);
      const liker = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: liker.id });
      await prisma.account.update({
        where: { id: liker.id },
        data: { deleted_at: new Date() },
      });

      // 제목과 일치하도록 예외 타입 + 메시지 둘 다 검증한다 (회귀 감지력 ↑).
      const promise = service.likeReview(liker.id, review.id);
      await expect(promise).rejects.toThrow(UnauthorizedException);
      await expect(promise).rejects.toThrow(/Account is deleted/);
    });
  });

  describe('unlikeReview', () => {
    async function setupLikedReview() {
      const review = await createReview(prisma);
      const liker = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: liker.id });
      await service.likeReview(liker.id, review.id);
      return { review, liker };
    }

    it('좋아요를 soft-delete하고 true를 반환한다', async () => {
      const { review, liker } = await setupLikedReview();

      const result = await service.unlikeReview(liker.id, review.id);

      expect(result).toBe(true);
      const activeLikes = await prisma.reviewLike.count({
        where: { review_id: review.id, account_id: liker.id, deleted_at: null },
      });
      expect(activeLikes).toBe(0);
    });

    it('좋아요가 없어도 true(멱등)', async () => {
      const review = await createReview(prisma);
      const user = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: user.id });

      const result = await service.unlikeReview(user.id, review.id);
      expect(result).toBe(true);
    });

    it('존재하지 않는 리뷰면 NotFoundException', async () => {
      const user = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: user.id });

      await expect(
        service.unlikeReview(user.id, BigInt(999999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('해제 후 다시 좋아요를 누르면 활성 레코드가 복원된다', async () => {
      const { review, liker } = await setupLikedReview();
      await service.unlikeReview(liker.id, review.id);

      const relike = await service.likeReview(liker.id, review.id);

      expect(relike).toBe(true);
      const activeLikes = await prisma.reviewLike.count({
        where: { review_id: review.id, account_id: liker.id, deleted_at: null },
      });
      expect(activeLikes).toBe(1);
    });
  });

  describe('writeReviewComment', () => {
    it('댓글을 생성하고 trim된 내용과 생성 정보를 반환한다', async () => {
      const review = await createReview(prisma);
      const commenter = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: commenter.id });

      const result = await service.writeReviewComment(commenter.id, {
        reviewId: review.id.toString(),
        content: '  너무 귀여워요  ',
      });

      expect(result.reviewId).toBe(review.id.toString());
      expect(result.content).toBe('너무 귀여워요');

      const saved = await prisma.reviewComment.findFirstOrThrow({
        where: { review_id: review.id, account_id: commenter.id },
      });
      expect(saved.content).toBe('너무 귀여워요');
    });

    it('존재하지 않는 리뷰면 NotFoundException', async () => {
      const commenter = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: commenter.id });

      await expect(
        service.writeReviewComment(commenter.id, {
          reviewId: '999999',
          content: '댓글',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('soft-delete된 리뷰에는 작성할 수 없다', async () => {
      const review = await createReview(prisma);
      await prisma.review.update({
        where: { id: review.id },
        data: { deleted_at: new Date() },
      });
      const commenter = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: commenter.id });

      await expect(
        service.writeReviewComment(commenter.id, {
          reviewId: review.id.toString(),
          content: '댓글',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteMyReviewComment', () => {
    async function setupComment() {
      const review = await createReview(prisma);
      const commenter = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: commenter.id });
      const comment = await service.writeReviewComment(commenter.id, {
        reviewId: review.id.toString(),
        content: '내 댓글',
      });
      return { review, commenter, commentId: BigInt(comment.id) };
    }

    it('본인 댓글을 soft-delete하고 true를 반환한다', async () => {
      const { commenter, commentId } = await setupComment();

      const result = await service.deleteMyReviewComment(
        commenter.id,
        commentId,
      );

      expect(result).toBe(true);
      const row = await prisma.reviewComment.findFirstOrThrow({
        where: { id: commentId, deleted_at: { not: null } },
      });
      expect(row.deleted_at).not.toBeNull();
    });

    it('타인 댓글이면 ForbiddenException', async () => {
      const { commentId } = await setupComment();
      const stranger = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: stranger.id });

      await expect(
        service.deleteMyReviewComment(stranger.id, commentId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('없는(또는 이미 삭제된) 댓글이면 NotFoundException', async () => {
      const { commenter, commentId } = await setupComment();
      await service.deleteMyReviewComment(commenter.id, commentId);

      await expect(
        service.deleteMyReviewComment(commenter.id, commentId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
