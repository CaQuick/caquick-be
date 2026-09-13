import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type ReviewReport,
  type ReviewReportReason,
} from '@prisma/client';

import { PrismaService } from '@/prisma';

/** 신고 대상 요약. account_id는 본인 작성물 판정용, content는 스냅샷용. */
export interface ReportTargetRow {
  id: bigint;
  account_id: bigint;
  content: string | null;
}

export type ReportTarget =
  { kind: 'review'; id: bigint } | { kind: 'review_comment'; id: bigint };

export type SubmitReportResult =
  | { outcome: 'created' | 'already-pending'; report: ReviewReport }
  | { outcome: 'not-found' | 'own-content' };

/**
 * 리뷰·댓글 신고 write/read. 대상은 구매자에게 보이는 상태(리뷰·댓글 미삭제 + 상품·매장 노출)여야
 * 신고할 수 있다 — 안 보이는 것을 신고하는 경로는 두지 않는다.
 */
@Injectable()
export class ReviewReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 대상 확인 → 본인 판정 → 미처리 신고 조회 → 생성을 한 트랜잭션에서 한다.
   * - 대상 행을 FOR UPDATE로 잠가(가시성 조인 포함) 작성자 삭제와 직렬화한다 — 잠금 전에 확인만
   *   하면 그 사이 삭제된 대상에 PENDING이 남아 복원된 새 내용에 붙는다
   * - 신고자 계정 행도 잠가 같은 신고자의 동시 요청이 중복 PENDING을 만들지 못하게 한다.
   *   unique 대신 잠금인 이유: 처리(RESOLVED/REJECTED) 뒤 같은 대상을 다시 신고할 수 있어야 한다
   */
  async submitReport(args: {
    reporterAccountId: bigint;
    target: ReportTarget;
    reason: ReviewReportReason;
    detail: string | null;
    snapshotLength: number;
  }): Promise<SubmitReportResult> {
    return this.prisma.$transaction(async (tx) => {
      const target = await this.lockReportableTarget(tx, args.target);
      if (!target) return { outcome: 'not-found' };
      if (target.account_id === args.reporterAccountId) {
        return { outcome: 'own-content' };
      }

      await tx.$queryRaw`
        SELECT id FROM account WHERE id = ${args.reporterAccountId} FOR UPDATE`;
      const targetWhere =
        args.target.kind === 'review'
          ? { review_id: args.target.id }
          : { review_comment_id: args.target.id };
      const pending = await tx.reviewReport.findFirst({
        where: {
          reporter_account_id: args.reporterAccountId,
          status: 'PENDING',
          ...targetWhere,
        },
        orderBy: { id: 'asc' },
      });
      if (pending) return { outcome: 'already-pending', report: pending };

      const report = await tx.reviewReport.create({
        data: {
          reporter_account_id: args.reporterAccountId,
          review_id: args.target.kind === 'review' ? args.target.id : null,
          review_comment_id:
            args.target.kind === 'review_comment' ? args.target.id : null,
          reason: args.reason,
          detail: args.detail,
          // 작성자가 삭제·재작성하면 같은 id가 새 내용으로 복원되므로 신고 시점 본문을 남긴다
          content_snapshot:
            target.content?.slice(0, args.snapshotLength) ?? null,
        },
      });
      return { outcome: 'created', report };
    });
  }

  /** 보이는 대상만 잠근다(리뷰·댓글 미삭제 + 상품·매장 노출). 없으면 null. */
  private async lockReportableTarget(
    tx: Prisma.TransactionClient,
    target: ReportTarget,
  ): Promise<ReportTargetRow | null> {
    const rows =
      target.kind === 'review'
        ? await tx.$queryRaw<ReportTargetRow[]>(Prisma.sql`
            SELECT r.id, r.account_id, r.content
            FROM review r
            JOIN product p
              ON p.id = r.product_id AND p.is_active = 1 AND p.deleted_at IS NULL
            JOIN store s
              ON s.id = p.store_id AND s.is_active = 1 AND s.deleted_at IS NULL
            WHERE r.id = ${target.id} AND r.deleted_at IS NULL
            FOR UPDATE OF r
          `)
        : await tx.$queryRaw<ReportTargetRow[]>(Prisma.sql`
            SELECT c.id, c.account_id, c.content
            FROM review_comment c
            JOIN review r ON r.id = c.review_id AND r.deleted_at IS NULL
            JOIN product p
              ON p.id = r.product_id AND p.is_active = 1 AND p.deleted_at IS NULL
            JOIN store s
              ON s.id = p.store_id AND s.is_active = 1 AND s.deleted_at IS NULL
            WHERE c.id = ${target.id} AND c.deleted_at IS NULL
            FOR UPDATE OF c
          `);
    return rows[0] ?? null;
  }
}
