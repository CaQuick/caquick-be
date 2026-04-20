import { BadRequestException, NotFoundException } from '@nestjs/common';
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

      await expect(service.likeReview(liker.id, review.id)).rejects.toThrow(
        /Account is deleted/,
      );
    });
  });
});
