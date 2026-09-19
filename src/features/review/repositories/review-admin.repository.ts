import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  lockActiveReviewRow,
  lockParentReviewOfComment,
  resolvePendingReports,
} from '@/features/review/repositories/review-lock.helper';
import {
  AuditActionType,
  AuditTargetType,
  Prisma,
  type ReviewReport,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

/** 작성자 닉네임(탈퇴 판정용 deleted_at 동반). */
const authorInclude = {
  account: {
    select: { user_profile: { select: { nickname: true, deleted_at: true } } },
  },
} as const;

export type AdminReviewReportDetailRow = Prisma.ReviewReportGetPayload<{
  include: typeof reviewReportDetailInclude;
}>;
const reviewReportDetailInclude = {
  review: {
    select: {
      id: true,
      account_id: true,
      store_id: true,
      content: true,
      deleted_at: true,
      ...authorInclude,
    },
  },
  review_comment: {
    select: {
      id: true,
      review_id: true,
      account_id: true,
      content: true,
      deleted_at: true,
      review: { select: { store_id: true } },
      ...authorInclude,
    },
  },
} as const;

export type AdminReviewRow = Prisma.ReviewGetPayload<{
  include: typeof adminReviewInclude;
}>;
const adminReviewInclude = {
  store: { select: { store_name: true } },
  ...authorInclude,
  _count: {
    select: {
      comments: { where: activeWhere },
      likes: { where: activeWhere },
    },
  },
} as const;

export type AdminReviewCommentRow = Prisma.ReviewCommentGetPayload<{
  include: typeof adminReviewCommentInclude;
}>;
const adminReviewCommentInclude = { ...authorInclude } as const;

/** 관리자 리뷰 모더레이션(신고 처리·리뷰/댓글 강제 삭제·조회). 잠금 순서(리뷰 → 댓글 → 신고)와 신고 종결은 review-lock.helper 1벌. */
@Injectable()
export class ReviewAdminRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  // ── 리뷰 모더레이션 ──

  /**
   * 대상 FK가 둘 다 비워진 신고(대상 하드 삭제 시 ON DELETE SET NULL)는 없는 것으로 본다 —
   * 앱 경로는 soft-delete뿐이라 정상 흐름에서는 생기지 않지만, 생기면 리뷰 신고로 잘못 해석돼
   * `review_id: null` 필터가 댓글 신고 전부에 번진다.
   */
  private readonly targetedReportWhere: Prisma.ReviewReportWhereInput = {
    OR: [{ review_id: { not: null } }, { review_comment_id: { not: null } }],
  };

  private reviewReportFilterWhere(filter: {
    status: 'PENDING' | 'RESOLVED' | 'REJECTED' | null;
    targetType?: 'REVIEW' | 'REVIEW_COMMENT';
  }): Prisma.ReviewReportWhereInput {
    return {
      ...this.targetedReportWhere,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.targetType === 'REVIEW' ? { review_id: { not: null } } : {}),
      ...(filter.targetType === 'REVIEW_COMMENT'
        ? { review_comment_id: { not: null } }
        : {}),
    };
  }

  async listReviewReports(args: {
    status: 'PENDING' | 'RESOLVED' | 'REJECTED' | null;
    targetType?: 'REVIEW' | 'REVIEW_COMMENT';
    limit: number;
    cursor?: bigint;
  }): Promise<ReviewReport[]> {
    return this.prisma.reviewReport.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.reviewReportFilterWhere(args),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countReviewReports(filter: {
    status: 'PENDING' | 'RESOLVED' | 'REJECTED' | null;
    targetType?: 'REVIEW' | 'REVIEW_COMMENT';
  }): Promise<number> {
    return this.prisma.reviewReport.count({
      where: this.reviewReportFilterWhere(filter),
    });
  }

  async findReviewReportDetailById(
    reportId: bigint,
  ): Promise<AdminReviewReportDetailRow | null> {
    return this.prisma.reviewReport.findFirst({
      where: { id: reportId, ...this.targetedReportWhere },
      include: reviewReportDetailInclude,
    });
  }

  async resolveReviewReport(args: {
    reportId: bigint;
    action: 'DELETE_TARGET' | 'REJECT';
    note: string | null;
    actorAccountId: bigint;
  }): Promise<ReviewReport | 'not-found' | 'already-resolved'> {
    const now = new Date();
    // 대상 id는 불변이라 트랜잭션 밖에서 읽는다 — 트랜잭션 안의 첫 일반 읽기가 REPEATABLE READ
    // 스냅샷을 고정하므로, 잠금보다 먼저 읽으면 잠금 뒤 읽는 상태가 낡는다
    const peek = await this.prisma.reviewReport.findFirst({
      where: { id: args.reportId },
      select: { review_id: true, review_comment_id: true },
    });
    if (!peek) return 'not-found';
    // 대상 FK가 둘 다 비워진 신고는 없는 것으로 본다(targetedReportWhere와 같은 기준)
    const target = peek.review_comment_id
      ? { kind: 'review_comment' as const, id: peek.review_comment_id }
      : peek.review_id
        ? { kind: 'review' as const, id: peek.review_id }
        : null;
    if (!target) return 'not-found';

    return this.prisma.$transaction(async (tx) => {
      // 잠금 순서: (부모 리뷰 →) 대상(리뷰/댓글) → 신고. 강제 삭제 경로도 같은 순서라, 같은 대상의
      // 다른 신고를 동시에 처리하는 두 트랜잭션이 서로의 잠금을 기다리는 교착이 생기지 않는다.
      // 대상이 이미 삭제됐으면 잠기지 않지만 신고 처리는 계속돼야 한다
      if (target.kind === 'review_comment') {
        await lockParentReviewOfComment(tx, target.id);
      }
      await lockActiveReviewRow(tx, target.kind, target.id);

      if (!(await lockActiveReviewRow(tx, 'review_report', args.reportId))) {
        return 'not-found';
      }
      const report = await tx.reviewReport.findFirstOrThrow({
        where: { id: args.reportId },
      });
      if (report.status !== 'PENDING') return 'already-resolved';

      if (args.action === 'DELETE_TARGET') {
        await this.softDeleteTargetTx(tx, target, now, args.actorAccountId, {
          reportId: report.id,
          note: args.note,
        });
        // 같은 대상의 다른 미처리 신고도 함께 닫는다(이 건 포함). 리뷰면 함께 내려간 댓글 신고까지
        await tx.reviewReport.updateMany({
          where: {
            status: 'PENDING',
            ...(target.kind === 'review'
              ? {
                  OR: [
                    { review_id: target.id },
                    { review_comment: { review_id: target.id } },
                  ],
                }
              : { review_comment_id: target.id }),
          },
          data: {
            status: 'RESOLVED',
            resolved_by_account_id: args.actorAccountId,
            resolved_at: now,
            resolution_note: args.note,
            updated_at: now,
          },
        });
      } else {
        await tx.reviewReport.update({
          where: { id: report.id },
          data: {
            status: 'REJECTED',
            resolved_by_account_id: args.actorAccountId,
            resolved_at: now,
            resolution_note: args.note,
          },
        });
      }

      await this.auditLogs.createAuditLog(
        {
          actorAccountId: args.actorAccountId,
          storeId: null,
          targetType: AuditTargetType.REVIEW_REPORT,
          targetId: report.id,
          action: AuditActionType.STATUS_CHANGE,
          beforeJson: { status: 'PENDING' },
          afterJson: {
            status: args.action === 'DELETE_TARGET' ? 'RESOLVED' : 'REJECTED',
            action: args.action,
            note: args.note,
          },
        },
        tx,
      );
      return tx.reviewReport.findFirstOrThrow({ where: { id: report.id } });
    });
  }

  async adminSoftDeleteReview(args: {
    reviewId: bigint;
    reason: string;
    actorAccountId: bigint;
  }): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockActiveReviewRow(tx, 'review', args.reviewId)))
        return false;
      await this.softDeleteTargetTx(
        tx,
        { kind: 'review', id: args.reviewId },
        now,
        args.actorAccountId,
        { reportId: null, note: args.reason },
      );
      // 리뷰와 함께 내려간 댓글을 겨냥한 신고도 닫는다(작성자 삭제 경로와 같은 범위)
      await resolvePendingReports(tx, {
        where: {
          OR: [
            { review_id: args.reviewId },
            { review_comment: { review_id: args.reviewId } },
          ],
        },
        now,
        resolvedByAccountId: args.actorAccountId,
        note: args.reason,
      });
      return true;
    });
  }

  async adminSoftDeleteReviewComment(args: {
    commentId: bigint;
    reason: string;
    actorAccountId: bigint;
  }): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await lockParentReviewOfComment(tx, args.commentId);
      if (!(await lockActiveReviewRow(tx, 'review_comment', args.commentId))) {
        return false;
      }
      await this.softDeleteTargetTx(
        tx,
        { kind: 'review_comment', id: args.commentId },
        now,
        args.actorAccountId,
        { reportId: null, note: args.reason },
      );
      await resolvePendingReports(tx, {
        where: { review_comment_id: args.commentId },
        now,
        resolvedByAccountId: args.actorAccountId,
        note: args.reason,
      });
      return true;
    });
  }

  /**
   * 대상 soft-delete + DELETE 감사. 리뷰는 작성자 본인 삭제(user feature)와 같은 범위로
   * 사진·댓글을 함께 내린다 — 리뷰 재작성이 같은 id를 복원하므로 남겨 두면 되살아난다.
   * 이미 삭제된 대상이면 조용히 지나간다(신고 처리는 계속돼야 한다).
   */
  private async softDeleteTargetTx(
    tx: Prisma.TransactionClient,
    target: { kind: 'review' | 'review_comment'; id: bigint },
    now: Date,
    actorAccountId: bigint,
    meta: { reportId: bigint | null; note: string | null },
  ): Promise<void> {
    if (target.kind === 'review') {
      const review = await tx.review.findFirst({
        where: { id: target.id },
        select: { store_id: true },
      });
      if (!review) return;
      await tx.review.update({
        where: { id: target.id },
        data: { deleted_at: now },
      });
      await tx.reviewMedia.updateMany({
        where: { review_id: target.id, ...activeWhere },
        data: { deleted_at: now },
      });
      await tx.reviewComment.updateMany({
        where: { review_id: target.id, ...activeWhere },
        data: { deleted_at: now },
      });
      await this.auditLogs.createAuditLog(
        {
          actorAccountId,
          storeId: review.store_id,
          targetType: AuditTargetType.REVIEW,
          targetId: target.id,
          action: AuditActionType.DELETE,
          afterJson: {
            reportId: meta.reportId?.toString() ?? null,
            reason: meta.note,
          },
        },
        tx,
      );
      return;
    }
    const comment = await tx.reviewComment.findFirst({
      where: { id: target.id },
      select: { review: { select: { store_id: true } } },
    });
    if (!comment) return;
    await tx.reviewComment.update({
      where: { id: target.id },
      data: { deleted_at: now },
    });
    await this.auditLogs.createAuditLog(
      {
        actorAccountId,
        storeId: comment.review.store_id,
        targetType: AuditTargetType.REVIEW_COMMENT,
        targetId: target.id,
        action: AuditActionType.DELETE,
        afterJson: {
          reportId: meta.reportId?.toString() ?? null,
          reason: meta.note,
        },
      },
      tx,
    );
  }

  // ── 리뷰·댓글 조회(관리자) ──

  private reviewFilterWhere(filter: {
    keyword?: string;
    storeId?: bigint;
    accountId?: bigint;
    includeDeleted: boolean;
  }): Prisma.ReviewWhereInput {
    return {
      ...(filter.keyword ? { content: { contains: filter.keyword } } : {}),
      ...(filter.storeId !== undefined ? { store_id: filter.storeId } : {}),
      ...(filter.accountId !== undefined
        ? { account_id: filter.accountId }
        : {}),
      // deleted_at 키를 명시하면 soft-delete 자동 필터가 빠진다(삭제 포함 조회)
      ...(filter.includeDeleted ? { deleted_at: undefined } : {}),
    };
  }

  async listReviews(args: {
    keyword?: string;
    storeId?: bigint;
    accountId?: bigint;
    includeDeleted: boolean;
    limit: number;
    cursor?: bigint;
  }): Promise<AdminReviewRow[]> {
    return this.prisma.review.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.reviewFilterWhere(args),
      },
      include: adminReviewInclude,
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countReviews(filter: {
    keyword?: string;
    storeId?: bigint;
    accountId?: bigint;
    includeDeleted: boolean;
  }): Promise<number> {
    return this.prisma.review.count({ where: this.reviewFilterWhere(filter) });
  }

  private reviewCommentFilterWhere(filter: {
    reviewId?: bigint;
    accountId?: bigint;
    includeDeleted: boolean;
  }): Prisma.ReviewCommentWhereInput {
    return {
      ...(filter.reviewId !== undefined ? { review_id: filter.reviewId } : {}),
      ...(filter.accountId !== undefined
        ? { account_id: filter.accountId }
        : {}),
      ...(filter.includeDeleted ? { deleted_at: undefined } : {}),
    };
  }

  async listReviewComments(args: {
    reviewId?: bigint;
    accountId?: bigint;
    includeDeleted: boolean;
    limit: number;
    cursor?: bigint;
  }): Promise<AdminReviewCommentRow[]> {
    return this.prisma.reviewComment.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.reviewCommentFilterWhere(args),
      },
      include: adminReviewCommentInclude,
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countReviewComments(filter: {
    reviewId?: bigint;
    accountId?: bigint;
    includeDeleted: boolean;
  }): Promise<number> {
    return this.prisma.reviewComment.count({
      where: this.reviewCommentFilterWhere(filter),
    });
  }
}
