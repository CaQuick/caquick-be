import { Injectable } from '@nestjs/common';
import type { ReviewReport, ReviewReportReason } from '@prisma/client';

import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

/** 신고 대상 요약. account_id는 본인 작성물 판정용. */
export interface ReportTargetRow {
  id: bigint;
  account_id: bigint;
}

/**
 * 리뷰·댓글 신고 write/read. 대상은 구매자에게 보이는 상태(리뷰·댓글 미삭제 + 상품·매장 노출)여야
 * 신고할 수 있다 — 안 보이는 것을 신고하는 경로는 두지 않는다.
 */
@Injectable()
export class ReviewReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findReportableReview(
    reviewId: bigint,
  ): Promise<ReportTargetRow | null> {
    return this.prisma.review.findFirst({
      where: {
        id: reviewId,
        product: { ...visibleWhere, store: visibleWhere },
      },
      select: { id: true, account_id: true },
    });
  }

  async findReportableComment(
    commentId: bigint,
  ): Promise<ReportTargetRow | null> {
    return this.prisma.reviewComment.findFirst({
      where: {
        id: commentId,
        review: {
          ...activeWhere,
          product: { ...visibleWhere, store: visibleWhere },
        },
      },
      select: { id: true, account_id: true },
    });
  }

  /**
   * 같은 신고자·대상의 미처리(PENDING) 신고가 있으면 그 건을, 없으면 새로 만들어 돌려준다.
   * 신고자 계정 행을 잠근(FOR UPDATE) 트랜잭션 안에서 조회·생성하므로 같은 신고자의 동시 요청이
   * 중복 PENDING을 만들지 못한다. unique 대신 잠금을 쓰는 이유: 처리된 뒤 재신고는 허용해야 한다.
   */
  async findOrCreatePendingReport(args: {
    reporterAccountId: bigint;
    reviewId: bigint | null;
    reviewCommentId: bigint | null;
    reason: ReviewReportReason;
    detail: string | null;
  }): Promise<{ report: ReviewReport; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM account WHERE id = ${args.reporterAccountId} FOR UPDATE`;
      const pending = await tx.reviewReport.findFirst({
        where: {
          reporter_account_id: args.reporterAccountId,
          status: 'PENDING',
          ...(args.reviewId !== null ? { review_id: args.reviewId } : {}),
          ...(args.reviewCommentId !== null
            ? { review_comment_id: args.reviewCommentId }
            : {}),
        },
        orderBy: { id: 'asc' },
      });
      if (pending) return { report: pending, created: false };

      const report = await tx.reviewReport.create({
        data: {
          reporter_account_id: args.reporterAccountId,
          review_id: args.reviewId,
          review_comment_id: args.reviewCommentId,
          reason: args.reason,
          detail: args.detail,
        },
      });
      return { report, created: true };
    });
  }
}
