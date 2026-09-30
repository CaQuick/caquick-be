import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { ReviewAdminRepository } from '@/features/review/repositories/review-admin.repository';
import { ReviewRepository } from '@/features/review/repositories/review.repository';
import { AdminModerationService } from '@/features/review/services/review-admin.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createAccountCredential,
  createReview,
  createReviewMedia,
  createReviewReport,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminModerationService (real DB)', () => {
  let service: AdminModerationService;
  let reviewRepository: ReviewRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminModerationService,
        ReviewAdminRepository,
        ReviewRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminModerationService);
    reviewRepository = module.get(ReviewRepository);
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

    type Key = 'a' | 'b' | 'gone';
    it.each<
      [
        string,
        {
          reviewId: Key | '0' | null;
          includeDeleted?: boolean;
          cursor?: Key;
        },
        Key[],
        number,
      ]
    >([
      ['reviewId로 1건', { reviewId: 'a' }, ['a'], 1],
      ['"0"은 유효 ID라 0건', { reviewId: '0' }, [], 0],
      ['null은 미지정과 같아 전체', { reviewId: null }, ['b', 'a'], 2],
      ['삭제 리뷰는 기본 0건', { reviewId: 'gone' }, [], 0],
      [
        '삭제 리뷰는 includeDeleted면 1건',
        { reviewId: 'gone', includeDeleted: true },
        ['gone'],
        1,
      ],
      ['커서보다 앞선 리뷰면 1건', { reviewId: 'a', cursor: 'b' }, ['a'], 1],
      ['커서 이후에 없으면 0건', { reviewId: 'a', cursor: 'a' }, [], 1],
      // 커서가 필터의 id 조건을 덮으면 b 아래의 a까지 섞여 나온다
      [
        '커서가 reviewId 조건을 덮지 않는다',
        { reviewId: 'b', cursor: 'gone' },
        ['b'],
        1,
      ],
    ])(
      'reviewId 필터: %s',
      async (_, { reviewId, includeDeleted, cursor }, expected, total) => {
        const ids: Record<Key, bigint> = {
          a: (await createReview(prisma)).id,
          b: (await createReview(prisma)).id,
          gone: (await createReview(prisma)).id,
        };
        await prisma.review.update({
          where: { id: ids.gone },
          data: { deleted_at: new Date() },
        });
        const toId = (k: Key | '0' | null) =>
          k === null || k === '0' ? k : ids[k].toString();

        const result = await service.adminReviews(await admin(), {
          reviewId: toId(reviewId),
          includeDeleted,
          cursor: cursor && toId(cursor)!,
        });
        expect(result.items.map((r) => r.id)).toEqual(
          expected.map((k) => ids[k].toString()),
        );
        expect(result.totalCount).toBe(total);
      },
    );

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

  describe('첨부 미디어(media)', () => {
    async function adminReviewMedia(reviewId: bigint) {
      const result = await service.adminReviews(await admin(), {
        reviewId: reviewId.toString(),
        includeDeleted: true,
      });
      return result.items[0].media;
    }

    const T1 = new Date('2026-09-01T00:00:00.000Z');
    const T1_PLUS_1MS = new Date('2026-09-01T00:00:00.001Z');
    const T0 = new Date('2026-08-01T00:00:00.000Z');
    it.each<[string, Date | null, Date | null, boolean]>([
      ['활성 리뷰의 활성 사진은 보인다', null, null, true],
      ['활성 리뷰의 삭제 사진은 빠진다', null, T1, false],
      ['삭제 리뷰에 남은 활성 사진은 빠진다', T1, null, false],
      ['삭제 리뷰와 같은 시각에 내려간 사진은 보인다', T1, T1, true],
      ['삭제 리뷰보다 먼저 내려간 재작성 전 세대 사진은 빠진다', T1, T0, false],
      ['1ms라도 시각이 다르면 빠진다', T1, T1_PLUS_1MS, false],
    ])('%s', async (_, reviewDeletedAt, mediaDeletedAt, shown) => {
      const review = await createReview(prisma);
      await prisma.review.update({
        where: { id: review.id },
        data: { deleted_at: reviewDeletedAt },
      });
      await createReviewMedia(prisma, {
        review_id: review.id,
        media_url: 'x.png',
        deleted_at: mediaDeletedAt,
      });

      expect((await adminReviewMedia(review.id)).length).toBe(shown ? 1 : 0);
    });

    it('sortOrder 순(동률은 등록 순)으로 주고 동영상은 종류·썸네일을 함께 준다', async () => {
      const review = await createReview(prisma);
      await createReviewMedia(prisma, {
        review_id: review.id,
        media_type: 'VIDEO',
        media_url: 'v.mp4',
        thumbnail_url: 'v.jpg',
        sort_order: 1,
      });
      await createReviewMedia(prisma, {
        review_id: review.id,
        media_url: 'b.png',
        sort_order: 0,
      });
      await createReviewMedia(prisma, {
        review_id: review.id,
        media_url: 'c.png',
        sort_order: 0,
      });

      expect(await adminReviewMedia(review.id)).toEqual([
        {
          mediaType: 'IMAGE',
          mediaUrl: 'b.png',
          thumbnailUrl: null,
          sortOrder: 0,
        },
        {
          mediaType: 'IMAGE',
          mediaUrl: 'c.png',
          thumbnailUrl: null,
          sortOrder: 0,
        },
        {
          mediaType: 'VIDEO',
          mediaUrl: 'v.mp4',
          thumbnailUrl: 'v.jpg',
          sortOrder: 1,
        },
      ]);
    });

    // 매퍼는 "리뷰와 사진을 같은 now로 내린다"는 삭제 경로의 불변식에 기댄다 — 경로마다 실제로 거쳐 고정한다
    it.each<
      [string, (reviewId: bigint, accountId: bigint) => Promise<unknown>]
    >([
      [
        '관리자 강제 삭제',
        async (reviewId) =>
          service.adminDeleteReview(await admin(), {
            reviewId: reviewId.toString(),
            reason: '광고',
          }),
      ],
      [
        '신고 처리(DELETE_TARGET)',
        async (reviewId) => {
          const report = await createReviewReport(prisma, {
            review_id: reviewId,
          });
          return service.adminResolveReviewReport(await admin(), {
            reportId: report.id.toString(),
            action: 'DELETE_TARGET',
          });
        },
      ],
      [
        '작성자 삭제',
        (reviewId, accountId) =>
          reviewRepository.softDeleteReview({
            reviewId,
            accountId,
            now: new Date(),
          }),
      ],
    ])(
      '%s 뒤 삭제 포함 조회는 함께 내려간 사진만 주고 재작성 전 세대 사진은 뺀다',
      async (_, deleteReview) => {
        const review = await createReview(prisma);
        await createReviewMedia(prisma, {
          review_id: review.id,
          media_url: 'old.png',
          deleted_at: T0,
        });
        await createReviewMedia(prisma, {
          review_id: review.id,
          media_url: 'a.png',
          sort_order: 0,
        });
        await createReviewMedia(prisma, {
          review_id: review.id,
          media_url: 'b.png',
          sort_order: 1,
        });

        await deleteReview(review.id, review.account_id);

        expect(
          (await adminReviewMedia(review.id)).map((m) => m.mediaUrl),
        ).toEqual(['a.png', 'b.png']);
      },
    );

    it('신고 상세는 리뷰 대상이면 사진을 주고(처리 뒤에도 유지) 댓글 대상이면 빈 배열이다', async () => {
      const review = await createReview(prisma);
      await createReviewMedia(prisma, {
        review_id: review.id,
        media_url: 'a.png',
      });
      await createReviewMedia(prisma, {
        review_id: review.id,
        media_url: 'gone.png',
        deleted_at: T0,
      });
      const reviewReport = await createReviewReport(prisma, {
        review_id: review.id,
      });
      const comment = await commentOn(review.id);
      const commentReport = await createReviewReport(prisma, {
        review_id: null,
        review_comment_id: comment.id,
      });

      const before = await service.adminReviewReport(
        await admin(),
        reviewReport.id,
      );
      expect(before.target.media.map((m) => m.mediaUrl)).toEqual(['a.png']);
      expect(
        (await service.adminReviewReport(await admin(), commentReport.id))
          .target.media,
      ).toEqual([]);

      await service.adminResolveReviewReport(await admin(), {
        reportId: reviewReport.id.toString(),
        action: 'DELETE_TARGET',
      });
      const after = await service.adminReviewReport(
        await admin(),
        reviewReport.id,
      );
      expect(after.target.deleted).toBe(true);
      expect(after.target.media.map((m) => m.mediaUrl)).toEqual(['a.png']);
    });
  });

  describe('표시값(상품명·매장명·신고자·처리자)', () => {
    /** 이름·아이디가 모두 있는 관리자 — 라벨은 `이름(아이디)`. */
    async function namedAdmin(): Promise<bigint> {
      const account = await createAccount(prisma, {
        account_type: 'ADMIN',
        name: '이찬우',
      });
      await createAccountCredential(prisma, {
        account_id: account.id,
        username: 'chanwoo7',
      });
      return account.id;
    }

    it('리뷰 목록은 작성 시점 상품명을 준다', async () => {
      const review = await createReview(prisma, {
        product_name_snapshot: '작성 시점 케이크',
      });

      const result = await service.adminReviews(await admin());

      expect(result.items[0]).toMatchObject({
        id: review.id.toString(),
        productName: '작성 시점 케이크',
      });
    });

    it('신고 대상 매장명은 리뷰 작성 시점 값이고(리뷰·댓글 대상 모두) 매장명을 바꿔도 그대로다', async () => {
      const review = await createReview(prisma, {
        store_name_snapshot: '작성 시점 매장',
      });
      const reviewReport = await createReviewReport(prisma, {
        review_id: review.id,
      });
      const comment = await commentOn(review.id);
      const commentReport = await createReviewReport(prisma, {
        review_id: null,
        review_comment_id: comment.id,
      });
      await prisma.store.update({
        where: { id: review.store_id },
        data: { store_name: '바뀐 매장' },
      });

      for (const report of [reviewReport, commentReport]) {
        const detail = await service.adminReviewReport(
          await admin(),
          report.id,
        );
        expect(detail.target.storeName).toBe('작성 시점 매장');
      }
    });

    it.each([
      ['활동 중', false],
      ['탈퇴', true],
    ] as const)(
      '신고자 %s: 닉네임은 신고 시점 스냅샷, 탈퇴 여부는 조회 때 붙인다',
      async (_case, withdrawn) => {
        const reporter = await createAccount(prisma, { account_type: 'USER' });
        const report = await createReviewReport(prisma, {
          reporter_account_id: reporter.id,
          reporter_nickname_snapshot: '신고자닉',
        });
        if (withdrawn) {
          await prisma.account.update({
            where: { id: reporter.id },
            data: { deleted_at: new Date() },
          });
        }
        const viewer = await admin();

        const list = await service.adminReviewReports(viewer);
        const detail = await service.adminReviewReport(viewer, report.id);

        for (const row of [list.items[0], detail.report]) {
          expect(row).toMatchObject({
            reporterNickname: '신고자닉',
            reporterWithdrawn: withdrawn,
          });
        }
      },
    );

    it('신고 목록은 신고자마다 탈퇴 여부를 따로 붙인다', async () => {
      const gone = await createAccount(prisma, {
        account_type: 'USER',
        deleted_at: new Date(),
      });
      const active = await createAccount(prisma, { account_type: 'USER' });
      const r1 = await createReviewReport(prisma, {
        reporter_account_id: gone.id,
      });
      const r2 = await createReviewReport(prisma, {
        reporter_account_id: active.id,
      });

      const list = await service.adminReviewReports(await admin());

      expect(
        list.items.map((r) => [r.id, r.reporterNickname, r.reporterWithdrawn]),
      ).toEqual([
        [r2.id.toString(), null, false],
        [r1.id.toString(), null, true],
      ]);
    });

    it.each<[string, (actor: bigint, reviewId: bigint) => Promise<unknown>]>([
      [
        '신고 처리(REJECT)',
        async (actor) => {
          const report = await prisma.reviewReport.findFirstOrThrow();
          return service.adminResolveReviewReport(actor, {
            reportId: report.id.toString(),
            action: 'REJECT',
          });
        },
      ],
      [
        '신고 처리(DELETE_TARGET)',
        async (actor) => {
          const report = await prisma.reviewReport.findFirstOrThrow();
          return service.adminResolveReviewReport(actor, {
            reportId: report.id.toString(),
            action: 'DELETE_TARGET',
          });
        },
      ],
      [
        '리뷰 강제 삭제',
        (actor, reviewId) =>
          service.adminDeleteReview(actor, {
            reviewId: reviewId.toString(),
            reason: '위반',
          }),
      ],
    ])('%s: 처리자 라벨 `이름(아이디)`를 신고에 남긴다', async (_case, act) => {
      const review = await createReview(prisma);
      const report = await createReviewReport(prisma, {
        review_id: review.id,
      });
      const actor = await namedAdmin();

      await act(actor, review.id);

      const detail = await service.adminReviewReport(await admin(), report.id);
      expect(detail.report).toMatchObject({
        resolvedByAccountId: actor.toString(),
        resolvedByLabel: '이찬우(chanwoo7)',
      });
    });

    it('댓글 강제 삭제도 처리자 라벨을 남긴다', async () => {
      const review = await createReview(prisma);
      const comment = await commentOn(review.id);
      const report = await createReviewReport(prisma, {
        review_id: null,
        review_comment_id: comment.id,
      });

      await service.adminDeleteReviewComment(await namedAdmin(), {
        commentId: comment.id.toString(),
        reason: '위반',
      });

      const row = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: report.id },
      });
      expect(row.resolved_by_label_snapshot).toBe('이찬우(chanwoo7)');
    });

    it('처리 응답에도 라벨이 실리고, 이름·아이디가 없는 관리자는 null', async () => {
      const review = await createReview(prisma);
      const report = await createReviewReport(prisma, {
        review_id: review.id,
      });
      const bare = await createAccount(prisma, {
        account_type: 'ADMIN',
        name: null,
      });

      const result = await service.adminResolveReviewReport(bare.id, {
        reportId: report.id.toString(),
        action: 'REJECT',
      });

      expect(result.resolvedByAccountId).toBe(bare.id.toString());
      expect(result.resolvedByLabel).toBeNull();
    });

    it('작성자 삭제로 닫힌 신고는 처리자 라벨이 null', async () => {
      const review = await createReview(prisma);
      const report = await createReviewReport(prisma, {
        review_id: review.id,
      });

      await reviewRepository.softDeleteReview({
        reviewId: review.id,
        accountId: review.account_id,
        now: new Date(),
      });

      const detail = await service.adminReviewReport(await admin(), report.id);
      expect(detail.report).toMatchObject({
        status: 'RESOLVED',
        resolvedByAccountId: null,
        resolvedByLabel: null,
      });
    });
  });
});
