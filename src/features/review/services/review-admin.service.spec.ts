import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { ReviewAdminRepository } from '@/features/review/repositories/review-admin.repository';
import { AdminModerationService } from '@/features/review/services/review-admin.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createReview,
  createReviewMedia,
  createReviewReport,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminModerationService (real DB)', () => {
  let service: AdminModerationService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminModerationService,
        ReviewAdminRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminModerationService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function admin(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }

  async function commentOn(reviewId: bigint) {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, {
      account_id: account.id,
      nickname: `c_${account.id}`,
    });
    return prisma.reviewComment.create({
      data: { review_id: reviewId, account_id: account.id, content: '댓글' },
    });
  }

  async function auditCount(
    targetType: string,
    targetId: bigint,
    action?: string,
  ) {
    return prisma.auditLog.count({
      where: {
        target_type: targetType as never,
        target_id: targetId,
        ...(action ? { action: action as never } : {}),
      },
    });
  }

  describe('adminReviewReports / adminReviewReport', () => {
    it('기본은 PENDING만, status null이면 전체, targetType 필터, 최신순', async () => {
      const review = await createReview(prisma);
      const r1 = await createReviewReport(prisma, { review_id: review.id });
      const comment = await commentOn(review.id);
      const r2 = await createReviewReport(prisma, {
        review_id: null,
        review_comment_id: comment.id,
      });
      const resolved = await createReviewReport(prisma, { status: 'RESOLVED' });

      const pending = await service.adminReviewReports(await admin());
      expect(pending.totalCount).toBe(2);
      expect(pending.items.map((r) => r.id)).toEqual([
        r2.id.toString(),
        r1.id.toString(),
      ]);
      expect(pending.items[0].targetType).toBe('REVIEW_COMMENT');
      expect(pending.items[0].targetId).toBe(comment.id.toString());

      const all = await service.adminReviewReports(await admin(), {
        status: null,
      });
      expect(all.totalCount).toBe(3);
      expect(all.items.map((r) => r.id)).toContain(resolved.id.toString());

      const onlyReviews = await service.adminReviewReports(await admin(), {
        targetType: 'REVIEW',
      });
      expect(onlyReviews.items.map((r) => r.id)).toEqual([r1.id.toString()]);
    });

    it('상세는 대상 원문·작성자 닉네임·삭제 여부를 준다', async () => {
      const review = await createReview(prisma);
      const author = await prisma.account.findUniqueOrThrow({
        where: { id: review.account_id },
      });
      await createUserProfile(prisma, {
        account_id: author.id,
        nickname: 'writer',
      });
      const report = await createReviewReport(prisma, { review_id: review.id });

      const detail = await service.adminReviewReport(await admin(), report.id);

      expect(detail.report.id).toBe(report.id.toString());
      expect(detail.target).toMatchObject({
        id: review.id.toString(),
        reviewId: null,
        authorAccountId: review.account_id.toString(),
        authorNickname: 'writer',
        storeId: review.store_id.toString(),
        deleted: false,
      });

      await prisma.review.update({
        where: { id: review.id },
        data: { deleted_at: new Date() },
      });
      const after = await service.adminReviewReport(await admin(), report.id);
      expect(after.target.deleted).toBe(true);
    });

    it('댓글 신고 상세는 소속 리뷰 ID와 매장 ID를 준다', async () => {
      const review = await createReview(prisma);
      const comment = await commentOn(review.id);
      const report = await createReviewReport(prisma, {
        review_id: null,
        review_comment_id: comment.id,
      });

      const detail = await service.adminReviewReport(await admin(), report.id);
      expect(detail.target.reviewId).toBe(review.id.toString());
      expect(detail.target.storeId).toBe(review.store_id.toString());
      expect(detail.target.authorNickname).toBe(`c_${comment.account_id}`);
    });

    it('없는 신고면 404', async () => {
      await expect(
        service.adminReviewReport(await admin(), BigInt(999_999)),
      ).rejects.toThrowDomain(404);
    });
  });

  describe('adminResolveReviewReport', () => {
    it('DELETE_TARGET: 리뷰(사진·댓글 포함)를 삭제하고 같은 대상의 미처리 신고를 전부 RESOLVED로, 감사 2건', async () => {
      const actor = await admin();
      const review = await createReview(prisma);
      await createReviewMedia(prisma, {
        review_id: review.id,
        media_type: 'IMAGE',
        media_url: 'https://m/1.png',
        sort_order: 0,
      });
      const comment = await commentOn(review.id);
      const mine = await createReviewReport(prisma, { review_id: review.id });
      const other = await createReviewReport(prisma, { review_id: review.id });
      const unrelated = await createReviewReport(prisma);

      const result = await service.adminResolveReviewReport(actor, {
        reportId: mine.id.toString(),
        action: 'DELETE_TARGET',
        note: '  욕설  ',
      });

      expect(result.status).toBe('RESOLVED');
      expect(result.resolvedByAccountId).toBe(actor.toString());
      expect(result.resolutionNote).toBe('욕설');
      const rows = await prisma.reviewReport.findMany({
        where: { id: { in: [mine.id, other.id, unrelated.id] } },
        orderBy: { id: 'asc' },
      });
      expect(rows.map((r) => r.status)).toEqual([
        'RESOLVED',
        'RESOLVED',
        'PENDING',
      ]);
      expect(
        (await prisma.review.findUnique({ where: { id: review.id } }))!
          .deleted_at,
      ).not.toBeNull();
      expect(
        (await prisma.reviewComment.findUnique({ where: { id: comment.id } }))!
          .deleted_at,
      ).not.toBeNull();
      expect(
        await prisma.reviewMedia.findFirst({
          where: { review_id: review.id, deleted_at: { not: null } },
        }),
      ).not.toBeNull();
      expect(await auditCount('REVIEW_REPORT', mine.id, 'STATUS_CHANGE')).toBe(
        1,
      );
      expect(await auditCount('REVIEW', review.id, 'DELETE')).toBe(1);
    });

    it('DELETE_TARGET(댓글): 댓글만 삭제되고 리뷰는 유지', async () => {
      const review = await createReview(prisma);
      const comment = await commentOn(review.id);
      const report = await createReviewReport(prisma, {
        review_id: null,
        review_comment_id: comment.id,
      });

      await service.adminResolveReviewReport(await admin(), {
        reportId: report.id.toString(),
        action: 'DELETE_TARGET',
      });

      expect(
        (await prisma.reviewComment.findUnique({ where: { id: comment.id } }))!
          .deleted_at,
      ).not.toBeNull();
      expect(
        (await prisma.review.findUnique({ where: { id: review.id } }))!
          .deleted_at,
      ).toBeNull();
      expect(await auditCount('REVIEW_COMMENT', comment.id, 'DELETE')).toBe(1);
    });

    it('REJECT: 이 신고만 REJECTED, 대상과 다른 신고는 그대로', async () => {
      const review = await createReview(prisma);
      const mine = await createReviewReport(prisma, { review_id: review.id });
      const other = await createReviewReport(prisma, { review_id: review.id });

      const result = await service.adminResolveReviewReport(await admin(), {
        reportId: mine.id.toString(),
        action: 'REJECT',
        note: '문제 없음',
      });

      expect(result.status).toBe('REJECTED');
      expect(
        (
          await prisma.reviewReport.findUniqueOrThrow({
            where: { id: other.id },
          })
        ).status,
      ).toBe('PENDING');
      expect(
        (await prisma.review.findUnique({ where: { id: review.id } }))!
          .deleted_at,
      ).toBeNull();
      expect(await auditCount('REVIEW', review.id)).toBe(0);
    });

    // 대상 하드 삭제(ON DELETE SET NULL)로 FK가 둘 다 비면 리뷰 신고로 오해돼 review_id: null 필터가
    // 댓글 신고 전부에 번진다 — 목록·상세·처리 모두 없는 것으로 본다
    it('대상 FK가 비워진 신고는 목록·상세·처리에서 없는 것으로 보고 다른 신고에 번지지 않는다', async () => {
      const actor = await admin();
      const orphan = await createReviewReport(prisma);
      const comment = await commentOn((await createReview(prisma)).id);
      const other = await createReviewReport(prisma, {
        review_id: null,
        review_comment_id: comment.id,
      });
      await prisma.reviewReport.update({
        where: { id: orphan.id },
        data: { review_id: null },
      });

      const list = await service.adminReviewReports(actor);
      expect(list.items.map((r) => r.id)).toEqual([other.id.toString()]);
      expect(list.totalCount).toBe(1);
      await expect(
        service.adminReviewReport(actor, orphan.id),
      ).rejects.toThrowDomain(404);
      await expect(
        service.adminResolveReviewReport(actor, {
          reportId: orphan.id.toString(),
          action: 'DELETE_TARGET',
          note: 'x',
        }),
      ).rejects.toThrowDomain(404);
      expect(
        (
          await prisma.reviewReport.findUniqueOrThrow({
            where: { id: other.id },
          })
        ).status,
      ).toBe('PENDING');
    });

    it('이미 처리된 신고는 400, 없는 신고는 404', async () => {
      const report = await createReviewReport(prisma, { status: 'REJECTED' });
      await expect(
        service.adminResolveReviewReport(await admin(), {
          reportId: report.id.toString(),
          action: 'REJECT',
        }),
      ).rejects.toThrowDomain(400);
      await expect(
        service.adminResolveReviewReport(await admin(), {
          reportId: '999999',
          action: 'REJECT',
        }),
      ).rejects.toThrowDomain(404);
    });

    it('이미 삭제된 대상의 신고도 처리된다(대상 삭제 감사는 없음)', async () => {
      const review = await createReview(prisma);
      const report = await createReviewReport(prisma, { review_id: review.id });
      await prisma.review.update({
        where: { id: review.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.adminResolveReviewReport(await admin(), {
        reportId: report.id.toString(),
        action: 'DELETE_TARGET',
      });
      expect(result.status).toBe('RESOLVED');
      expect(await auditCount('REVIEW', review.id)).toBe(0);
    });

    it('같은 대상의 서로 다른 신고 두 건을 동시에 DELETE_TARGET 해도 교착 없이 둘 다 RESOLVED', async () => {
      const review = await createReview(prisma);
      const r1 = await createReviewReport(prisma, { review_id: review.id });
      const r2 = await createReviewReport(prisma, { review_id: review.id });
      const [a, b] = [await admin(), await admin()];

      const results = await Promise.allSettled([
        service.adminResolveReviewReport(a, {
          reportId: r1.id.toString(),
          action: 'DELETE_TARGET',
        }),
        service.adminResolveReviewReport(b, {
          reportId: r2.id.toString(),
          action: 'DELETE_TARGET',
        }),
      ]);

      // 한쪽이 먼저 대상을 삭제하며 다른 신고까지 RESOLVED로 닫으므로, 다른 쪽은 already-resolved(400)
      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const rejected = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(rejected.reason).toThrowDomain(400);
      const rows = await prisma.reviewReport.findMany({
        where: { id: { in: [r1.id, r2.id] } },
      });
      expect(rows.map((r) => r.status)).toEqual(['RESOLVED', 'RESOLVED']);
      expect(await auditCount('REVIEW', review.id, 'DELETE')).toBe(1);
    });

    it('두 관리자가 동시에 처리해도 한쪽만 성공하고 감사는 1건', async () => {
      const report = await createReviewReport(prisma);
      const [a, b] = [await admin(), await admin()];
      const results = await Promise.allSettled([
        service.adminResolveReviewReport(a, {
          reportId: report.id.toString(),
          action: 'REJECT',
        }),
        service.adminResolveReviewReport(b, {
          reportId: report.id.toString(),
          action: 'REJECT',
        }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(await auditCount('REVIEW_REPORT', report.id)).toBe(1);
    });
  });

  describe('adminDeleteReview / adminDeleteReviewComment', () => {
    it('리뷰 강제 삭제: cascade + 미처리 신고 RESOLVED(사유 메모) + 감사, 재삭제는 404', async () => {
      const actor = await admin();
      const review = await createReview(prisma);
      const comment = await commentOn(review.id);
      const report = await createReviewReport(prisma, { review_id: review.id });

      expect(
        await service.adminDeleteReview(actor, {
          reviewId: review.id.toString(),
          reason: '광고',
        }),
      ).toBe(true);

      expect(
        (await prisma.review.findUnique({ where: { id: review.id } }))!
          .deleted_at,
      ).not.toBeNull();
      expect(
        (await prisma.reviewComment.findUnique({ where: { id: comment.id } }))!
          .deleted_at,
      ).not.toBeNull();
      const closed = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: report.id },
      });
      expect(closed.status).toBe('RESOLVED');
      expect(closed.resolution_note).toBe('광고');
      expect(closed.resolved_by_account_id).toBe(actor);
      expect(await auditCount('REVIEW', review.id, 'DELETE')).toBe(1);
      await expect(
        service.adminDeleteReview(actor, {
          reviewId: review.id.toString(),
          reason: '광고',
        }),
      ).rejects.toThrowDomain(404);
    });

    it('리뷰 강제 삭제는 함께 내려간 댓글의 미처리 신고도 닫는다', async () => {
      const review = await createReview(prisma);
      const comment = await commentOn(review.id);
      const commentReport = await createReviewReport(prisma, {
        review_id: null,
        review_comment_id: comment.id,
      });

      await service.adminDeleteReview(await admin(), {
        reviewId: review.id.toString(),
        reason: '전체 정리',
      });

      const closed = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: commentReport.id },
      });
      expect(closed.status).toBe('RESOLVED');
      expect(closed.resolution_note).toBe('전체 정리');
    });

    it('댓글 강제 삭제: 댓글만 삭제 + 신고 RESOLVED + 감사', async () => {
      const review = await createReview(prisma);
      const comment = await commentOn(review.id);
      const report = await createReviewReport(prisma, {
        review_id: null,
        review_comment_id: comment.id,
      });

      expect(
        await service.adminDeleteReviewComment(await admin(), {
          commentId: comment.id.toString(),
          reason: '욕설',
        }),
      ).toBe(true);

      expect(
        (await prisma.review.findUnique({ where: { id: review.id } }))!
          .deleted_at,
      ).toBeNull();
      expect(
        (
          await prisma.reviewReport.findUniqueOrThrow({
            where: { id: report.id },
          })
        ).status,
      ).toBe('RESOLVED');
      expect(await auditCount('REVIEW_COMMENT', comment.id, 'DELETE')).toBe(1);
    });

    // 잠금 순서(리뷰 → 댓글 → 신고)가 두 경로에서 같아야 신고 행을 사이에 두고 교착하지 않는다
    it('리뷰 강제 삭제와 그 댓글 강제 삭제가 겹쳐도 둘 다 실패하지 않고 댓글 신고는 닫힌다', async () => {
      const review = await createReview(prisma);
      const comment = await commentOn(review.id);
      const report = await createReviewReport(prisma, {
        review_id: null,
        review_comment_id: comment.id,
      });

      const [reviewDeleted, commentDeleted] = await Promise.allSettled([
        service.adminDeleteReview(await admin(), {
          reviewId: review.id.toString(),
          reason: '광고',
        }),
        service.adminDeleteReviewComment(await admin(), {
          commentId: comment.id.toString(),
          reason: '욕설',
        }),
      ]);

      expect(reviewDeleted).toEqual({ status: 'fulfilled', value: true });
      // 리뷰 삭제가 먼저면 댓글은 이미 내려가 404
      if (commentDeleted.status === 'rejected') {
        expect(commentDeleted.reason).toThrowDomain(404);
      }
      expect(
        (
          await prisma.reviewReport.findUniqueOrThrow({
            where: { id: report.id },
          })
        ).status,
      ).toBe('RESOLVED');
    });

    it('감사 기록이 실패하면 삭제도 롤백된다(같은 트랜잭션)', async () => {
      const review = await createReview(prisma);
      const auditLogs = service['auditLogs'];
      const spy = jest
        .spyOn(auditLogs, 'recordAudit')
        .mockRejectedValueOnce(new Error('audit down'));
      await expect(
        service.adminDeleteReview(await admin(), {
          reviewId: review.id.toString(),
          reason: 'x',
        }),
      ).rejects.toThrow('audit down');
      expect(
        (await prisma.review.findUnique({ where: { id: review.id } }))!
          .deleted_at,
      ).toBeNull();
      spy.mockRestore();
    });
  });

  describe('adminReviews / adminReviewComments', () => {
    it('keyword·storeId·accountId 필터, includeDeleted, 작성자 닉네임·집계', async () => {
      const review = await createReview(prisma, { content: '바늘처럼 뾰족' });
      await createUserProfile(prisma, {
        account_id: review.account_id,
        nickname: 'author1',
      });
      const other = await createReview(prisma, { content: '평범' });
      await prisma.review.update({
        where: { id: other.id },
        data: { deleted_at: new Date() },
      });
      await commentOn(review.id);

      const active = await service.adminReviews(await admin());
      expect(active.totalCount).toBe(1);
      expect(active.items[0]).toMatchObject({
        id: review.id.toString(),
        authorNickname: 'author1',
        rating: 5,
        commentCount: 1,
        likeCount: 0,
        deleted: false,
      });

      const withDeleted = await service.adminReviews(await admin(), {
        includeDeleted: true,
      });
      expect(withDeleted.totalCount).toBe(2);
      expect(
        withDeleted.items.find((r) => r.id === other.id.toString())?.deleted,
      ).toBe(true);

      expect(
        (await service.adminReviews(await admin(), { keyword: '바늘' }))
          .totalCount,
      ).toBe(1);
      expect(
        (
          await service.adminReviews(await admin(), {
            storeId: review.store_id.toString(),
          })
        ).totalCount,
      ).toBe(1);
      expect(
        (
          await service.adminReviews(await admin(), {
            accountId: review.account_id.toString(),
          })
        ).totalCount,
      ).toBe(1);
      expect(
        (await service.adminReviews(await admin(), { storeId: '0' }))
          .totalCount,
      ).toBe(0);
    });

    it('댓글 목록: reviewId 필터·includeDeleted·페이지', async () => {
      const review = await createReview(prisma);
      const c1 = await commentOn(review.id);
      const c2 = await commentOn(review.id);
      const gone = await commentOn(review.id);
      await prisma.reviewComment.update({
        where: { id: gone.id },
        data: { deleted_at: new Date() },
      });
      await commentOn((await createReview(prisma)).id);

      const list = await service.adminReviewComments(await admin(), {
        reviewId: review.id.toString(),
      });
      expect(list.totalCount).toBe(2);
      expect(list.items.map((c) => c.id)).toEqual([
        c2.id.toString(),
        c1.id.toString(),
      ]);

      const withDeleted = await service.adminReviewComments(await admin(), {
        reviewId: review.id.toString(),
        includeDeleted: true,
        limit: 2,
      });
      expect(withDeleted.totalCount).toBe(3);
      expect(withDeleted.hasMore).toBe(true);
      expect(withDeleted.items[0].deleted).toBe(true);
    });
  });
});
