import { ReviewReportRepository } from '@/features/user/repositories/review-report.repository';
import { ReviewRepository } from '@/features/user/repositories/review.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserReportService } from '@/features/user/services/user-report.service';
import type { PrismaClient } from '@/generated/prisma/client';
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
  let reviewRepo: ReviewRepository;
  let userRepo: UserRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserReportService,
        UserRepository,
        ReviewReportRepository,
        ReviewRepository,
      ],
    });
    service = module.get(UserReportService);
    reviewRepo = module.get(ReviewRepository);
    userRepo = module.get(UserRepository);
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

    it('신고 시점의 본문을 스냅샷으로 남긴다', async () => {
      const { review } = await visibleReview();
      await prisma.review.update({
        where: { id: review.id },
        data: { content: '원래 내용' },
      });

      const result = await service.reportReview(await buyer(), {
        reviewId: review.id.toString(),
        reason: 'ABUSE',
      });

      const row = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: BigInt(result.reportId) },
      });
      expect(row.content_snapshot).toBe('원래 내용');
    });

    it('작성자가 리뷰를 삭제하면 그 리뷰·댓글의 미처리 신고가 RESOLVED(작성자 삭제)로 닫힌다', async () => {
      const { review, author } = await visibleReview();
      const comment = await commentOn(review.id, await buyer());
      const r1 = await service.reportReview(await buyer(), {
        reviewId: review.id.toString(),
        reason: 'SPAM',
      });
      const r2 = await service.reportReviewComment(await buyer(), {
        commentId: comment.id.toString(),
        reason: 'SPAM',
      });

      expect(
        await reviewRepo.softDeleteReview({
          reviewId: review.id,
          accountId: author,
          now: new Date(),
        }),
      ).toBe(true);

      const rows = await prisma.reviewReport.findMany({
        where: { id: { in: [BigInt(r1.reportId), BigInt(r2.reportId)] } },
      });
      expect(rows.map((r) => r.status)).toEqual(['RESOLVED', 'RESOLVED']);
      expect(rows[0].resolution_note).toBe('작성자가 대상을 삭제함');
      expect(rows[0].resolved_by_account_id).toBeNull();
    });

    it('삭제된 리뷰를 같은 id로 재작성해도 옛 신고가 새 내용에 붙지 않는다', async () => {
      const { review, author } = await visibleReview();
      const r = await service.reportReview(await buyer(), {
        reviewId: review.id.toString(),
        reason: 'SPAM',
      });
      // 삭제 경로를 거치지 않은 잔여 PENDING(방어 대상)을 흉내 낸다
      await prisma.review.update({
        where: { id: review.id },
        data: { deleted_at: new Date() },
      });

      await reviewRepo.createOrRestoreReviewWithMedia({
        orderItemId: review.order_item_id,
        accountId: author,
        storeId: review.store_id,
        productId: review.product_id,
        rating: 5,
        content: '새 내용',
        existingDeletedReviewId: review.id,
        media: [],
      });

      const row = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: BigInt(r.reportId) },
      });
      expect(row.status).toBe('RESOLVED');
      expect(row.content_snapshot).not.toBe('새 내용');
    });

    it('작성자가 댓글을 삭제하면 그 댓글의 미처리 신고가 닫힌다', async () => {
      const { review } = await visibleReview();
      const commenter = await buyer();
      const comment = await commentOn(review.id, commenter);
      const r = await service.reportReviewComment(await buyer(), {
        commentId: comment.id.toString(),
        reason: 'SPAM',
      });

      expect(
        await userRepo.softDeleteMyReviewComment({
          accountId: commenter,
          commentId: comment.id,
        }),
      ).toBe('deleted');

      const row = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: BigInt(r.reportId) },
      });
      expect(row.status).toBe('RESOLVED');
    });

    it('본인 리뷰는 400', async () => {
      const { review, author } = await visibleReview();
      await expect(
        service.reportReview(author, {
          reviewId: review.id.toString(),
          reason: 'SPAM',
        }),
      ).rejects.toThrowDomain(400);
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
      ).rejects.toThrowDomain(404);
    });

    it('USER가 아니면 403', async () => {
      const { review } = await visibleReview();
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      await expect(
        service.reportReview(seller.id, {
          reviewId: review.id.toString(),
          reason: 'SPAM',
        }),
      ).rejects.toThrowDomain(403);
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

    it('본인 댓글은 400, 삭제된 댓글·삭제된 리뷰의 댓글은 404', async () => {
      const { review } = await visibleReview();
      const commenter = await buyer();
      const comment = await commentOn(review.id, commenter);
      await expect(
        service.reportReviewComment(commenter, {
          commentId: comment.id.toString(),
          reason: 'ABUSE',
        }),
      ).rejects.toThrowDomain(400);

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
      ).rejects.toThrowDomain(404);

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
      ).rejects.toThrowDomain(404);
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

    // 잠금 순서(리뷰 → 댓글 → 신고)가 삭제 두 경로에서 같아야 신고 행을 사이에 두고 교착하지 않는다
    it('신고된 댓글 삭제와 부모 리뷰 삭제가 겹쳐도 둘 다 실패하지 않고 신고는 닫힌다', async () => {
      const { review, author } = await visibleReview();
      const commenter = await buyer();
      const comment = await commentOn(review.id, commenter);
      const r = await service.reportReviewComment(await buyer(), {
        commentId: comment.id.toString(),
        reason: 'SPAM',
      });

      const results = await Promise.all([
        reviewRepo.softDeleteReview({
          reviewId: review.id,
          accountId: author,
          now: new Date(),
        }),
        userRepo.softDeleteMyReviewComment({
          accountId: commenter,
          commentId: comment.id,
        }),
      ]);

      expect(results[0]).toBe(true);
      expect(['deleted', 'not-found']).toContain(results[1]);
      const row = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: BigInt(r.reportId) },
      });
      expect(row.status).toBe('RESOLVED');
    });

    // 어느 쪽이 먼저든 결과는 둘 중 하나여야 한다: NotFound 거절, 또는 접수 뒤 삭제가 닫음(RESOLVED).
    // 부모 리뷰 → 댓글 잠금 순서가 삭제와 같아야 교착 없이 이 성질이 유지된다
    it('부모 리뷰 삭제와 댓글 신고가 겹쳐도 PENDING 신고가 남지 않는다', async () => {
      const { review, author } = await visibleReview();
      const comment = await commentOn(review.id, await buyer());
      const reporter = await buyer();

      const [deleted, reported] = await Promise.allSettled([
        reviewRepo.softDeleteReview({
          reviewId: review.id,
          accountId: author,
          now: new Date(),
        }),
        service.reportReviewComment(reporter, {
          commentId: comment.id.toString(),
          reason: 'SPAM',
        }),
      ]);

      expect(deleted).toEqual({ status: 'fulfilled', value: true });
      if (reported.status === 'rejected') {
        expect(reported.reason).toThrowDomain(404);
      }
      const rows = await prisma.reviewReport.findMany({
        where: { review_comment_id: comment.id },
      });
      expect(rows.length).toBe(reported.status === 'fulfilled' ? 1 : 0);
      expect(rows.every((r) => r.status === 'RESOLVED')).toBe(true);
    });
  });
});
