import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ReviewReportRepository } from '@/features/user/repositories/review-report.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserReportService } from '@/features/user/services/user-report.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createReview,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('UserReportService (real DB)', () => {
  let service: UserReportService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [UserReportService, UserRepository, ReviewReportRepository],
    });
    service = module.get(UserReportService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function buyer(): Promise<bigint> {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    return account.id;
  }

  /** 노출 중인 매장·상품에 달린 리뷰(작성자는 별도 구매자). */
  async function visibleReview(
    overrides: { storeActive?: boolean; productActive?: boolean } = {},
  ) {
    const store = await createStore(prisma, {
      is_active: overrides.storeActive ?? true,
    });
    const product = await createProduct(prisma, {
      store_id: store.id,
      is_active: overrides.productActive ?? true,
    });
    const author = await buyer();
    const order = await createOrder(prisma, { account_id: author });
    const item = await createOrderItem(prisma, {
      order_id: order.id,
      store_id: store.id,
      product_id: product.id,
    });
    const review = await createReview(prisma, { order_item_id: item.id });
    return { review, author };
  }

  async function commentOn(reviewId: bigint, accountId: bigint) {
    return prisma.reviewComment.create({
      data: { review_id: reviewId, account_id: accountId, content: '댓글' },
    });
  }

  describe('reportReview', () => {
    it('신고를 접수하고 PENDING으로 저장한다', async () => {
      const { review } = await visibleReview();
      const reporter = await buyer();

      const result = await service.reportReview(reporter, {
        reviewId: review.id.toString(),
        reason: 'SPAM',
        detail: '  광고  ',
      });

      expect(result.status).toBe('PENDING');
      expect(result.alreadyReported).toBe(false);
      const row = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: BigInt(result.reportId) },
      });
      expect(row).toMatchObject({
        reporter_account_id: reporter,
        review_id: review.id,
        review_comment_id: null,
        reason: 'SPAM',
        detail: '광고',
      });
    });

    it('같은 리뷰에 미처리 신고가 있으면 새로 만들지 않고 그 건을 돌려준다(멱등)', async () => {
      const { review } = await visibleReview();
      const reporter = await buyer();
      const first = await service.reportReview(reporter, {
        reviewId: review.id.toString(),
        reason: 'SPAM',
      });

      const second = await service.reportReview(reporter, {
        reviewId: review.id.toString(),
        reason: 'ABUSE',
      });

      expect(second.reportId).toBe(first.reportId);
      expect(second.alreadyReported).toBe(true);
      expect(await prisma.reviewReport.count()).toBe(1);
    });

    it('같은 신고자의 동시 요청도 PENDING 1건만 만든다(신고자 행 잠금)', async () => {
      const { review } = await visibleReview();
      const reporter = await buyer();

      const results = await Promise.all([
        service.reportReview(reporter, {
          reviewId: review.id.toString(),
          reason: 'SPAM',
        }),
        service.reportReview(reporter, {
          reviewId: review.id.toString(),
          reason: 'SPAM',
        }),
      ]);

      expect(new Set(results.map((r) => r.reportId)).size).toBe(1);
      expect(results.filter((r) => r.alreadyReported)).toHaveLength(1);
      expect(await prisma.reviewReport.count()).toBe(1);
    });

    it('처리된(RESOLVED/REJECTED) 신고가 있으면 다시 신고할 수 있다', async () => {
      const { review } = await visibleReview();
      const reporter = await buyer();
      const first = await service.reportReview(reporter, {
        reviewId: review.id.toString(),
        reason: 'SPAM',
      });
      await prisma.reviewReport.update({
        where: { id: BigInt(first.reportId) },
        data: { status: 'REJECTED' },
      });

      const again = await service.reportReview(reporter, {
        reviewId: review.id.toString(),
        reason: 'SPAM',
      });

      expect(again.reportId).not.toBe(first.reportId);
      expect(again.alreadyReported).toBe(false);
    });

    it('본인 리뷰는 BadRequestException', async () => {
      const { review, author } = await visibleReview();
      await expect(
        service.reportReview(author, {
          reviewId: review.id.toString(),
          reason: 'SPAM',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // 보이지 않는 대상 전수: 삭제 리뷰·비활성 상품·비활성 매장·미존재
    it.each([
      [
        '삭제된 리뷰',
        async () => {
          const { review } = await visibleReview();
          await prisma.review.update({
            where: { id: review.id },
            data: { deleted_at: new Date() },
          });
          return review.id;
        },
      ],
      [
        '비활성 상품의 리뷰',
        async () => (await visibleReview({ productActive: false })).review.id,
      ],
      [
        '비활성 매장의 리뷰',
        async () => (await visibleReview({ storeActive: false })).review.id,
      ],
      ['없는 리뷰', () => Promise.resolve(BigInt(999_999))],
    ])('%s은 NotFoundException', async (_label, makeId) => {
      await expect(
        service.reportReview(await buyer(), {
          reviewId: (await makeId()).toString(),
          reason: 'SPAM',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('USER가 아니면 ForbiddenException', async () => {
      const { review } = await visibleReview();
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      await expect(
        service.reportReview(seller.id, {
          reviewId: review.id.toString(),
          reason: 'SPAM',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('reportReviewComment', () => {
    it('댓글 신고를 접수한다(review_id는 비움)', async () => {
      const { review } = await visibleReview();
      const commenter = await buyer();
      const comment = await commentOn(review.id, commenter);
      const reporter = await buyer();

      const result = await service.reportReviewComment(reporter, {
        commentId: comment.id.toString(),
        reason: 'ABUSE',
      });

      const row = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: BigInt(result.reportId) },
      });
      expect(row.review_comment_id).toBe(comment.id);
      expect(row.review_id).toBeNull();
    });

    it('본인 댓글은 BadRequestException, 삭제된 댓글·삭제된 리뷰의 댓글은 NotFoundException', async () => {
      const { review } = await visibleReview();
      const commenter = await buyer();
      const comment = await commentOn(review.id, commenter);
      await expect(
        service.reportReviewComment(commenter, {
          commentId: comment.id.toString(),
          reason: 'ABUSE',
        }),
      ).rejects.toThrow(BadRequestException);

      const deletedComment = await commentOn(review.id, commenter);
      await prisma.reviewComment.update({
        where: { id: deletedComment.id },
        data: { deleted_at: new Date() },
      });
      await expect(
        service.reportReviewComment(await buyer(), {
          commentId: deletedComment.id.toString(),
          reason: 'ABUSE',
        }),
      ).rejects.toThrow(NotFoundException);

      const other = await visibleReview();
      const orphan = await commentOn(other.review.id, commenter);
      await prisma.review.update({
        where: { id: other.review.id },
        data: { deleted_at: new Date() },
      });
      await expect(
        service.reportReviewComment(await buyer(), {
          commentId: orphan.id.toString(),
          reason: 'ABUSE',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('같은 댓글의 미처리 신고는 멱등이고, 리뷰 신고와는 별개로 센다', async () => {
      const { review } = await visibleReview();
      const comment = await commentOn(review.id, await buyer());
      const reporter = await buyer();

      await service.reportReview(reporter, {
        reviewId: review.id.toString(),
        reason: 'SPAM',
      });
      const c1 = await service.reportReviewComment(reporter, {
        commentId: comment.id.toString(),
        reason: 'ABUSE',
      });
      const c2 = await service.reportReviewComment(reporter, {
        commentId: comment.id.toString(),
        reason: 'ABUSE',
      });

      expect(c1.alreadyReported).toBe(false);
      expect(c2.reportId).toBe(c1.reportId);
      expect(await prisma.reviewReport.count()).toBe(2);
    });
  });
});
