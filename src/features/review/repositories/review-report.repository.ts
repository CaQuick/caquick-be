import { Injectable } from '@nestjs/common';

import { uniqueConstraintName } from '@/common/utils/prisma-error';
import {
  Prisma,
  type ReviewReport,
  type ReviewReportReason,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

/** PENDING 동안 unique를 거는 키 — 종결 시 NULL로 비운다. */
function openKeyOf(target: ReportTarget): string {
  return target.kind === 'review' ? `r:${target.id}` : `c:${target.id}`;
}

/** account_id는 본인 작성물 판정용, content는 스냅샷용. */
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

/** 대상은 구매자에게 보이는 상태(리뷰·댓글 미삭제 + 상품·매장 노출)여야 신고할 수 있다 — 안 보이는 것을 신고하는 경로는 두지 않는다. */
@Injectable()
export class ReviewReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 대상 확인 → 본인 판정 → 미처리 신고 조회 → 생성을 한 트랜잭션에서 한다.
   * - 대상 행을 FOR UPDATE로 잠가(가시성 조인 포함) 작성자 삭제와 직렬화한다 — 잠금 전에 확인만
   *   하면 그 사이 삭제된 대상에 PENDING이 남아 복원된 새 내용에 붙는다. 댓글은 부모 리뷰부터 잠근다
   * - 같은 신고자·대상의 중복 PENDING은 `uk_review_report_open`(reporter, open_key) unique가 막는다.
   *   open_key는 종결 시 NULL이 되고 MySQL unique는 NULL을 중복으로 보지 않아, 처리 뒤 재신고는 그대로 허용된다.
   *   동시 요청이 조회를 함께 통과하면 P2002를 받아 already-pending으로 돌려준다 — 신고자 계정 행 잠금은 필요 없다.
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

      try {
        const report = await tx.reviewReport.create({
          data: {
            reporter_account_id: args.reporterAccountId,
            review_id: args.target.kind === 'review' ? args.target.id : null,
            review_comment_id:
              args.target.kind === 'review_comment' ? args.target.id : null,
            reason: args.reason,
            detail: args.detail,
            open_key: openKeyOf(args.target),
            // 작성자가 삭제·재작성하면 같은 id가 새 내용으로 복원되므로 신고 시점 본문을 남긴다
            content_snapshot:
              target.content?.slice(0, args.snapshotLength) ?? null,
          },
        });
        return { outcome: 'created', report };
      } catch (error) {
        // 같은 신고자의 동시 요청이 조회를 함께 통과한 경우 — unique가 한쪽만 통과시킨다
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          uniqueConstraintName(error) === 'uk_review_report_open'
        ) {
          const raced = await tx.reviewReport.findFirstOrThrow({
            where: {
              reporter_account_id: args.reporterAccountId,
              open_key: openKeyOf(args.target),
            },
          });
          return { outcome: 'already-pending', report: raced };
        }
        throw error;
      }
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
        : await this.lockReportableComment(tx, target.id);
    return rows[0] ?? null;
  }

  /**
   * 댓글은 부모 리뷰 → 댓글 순으로 잠근다. 리뷰 삭제(softDeleteReview)가 리뷰를 잠근 뒤 댓글을
   * 정리하므로 같은 순서여야 교착이 없고, 삭제가 신고 접수보다 먼저면 댓글 재확인에서 not-found,
   * 나중이면 접수된 신고까지 삭제 쪽이 닫는다.
   */
  private async lockReportableComment(
    tx: Prisma.TransactionClient,
    commentId: bigint,
  ): Promise<ReportTargetRow[]> {
    const parents = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      SELECT r.id
      FROM review r
      JOIN review_comment c ON c.review_id = r.id
      JOIN product p
        ON p.id = r.product_id AND p.is_active = 1 AND p.deleted_at IS NULL
      JOIN store s
        ON s.id = p.store_id AND s.is_active = 1 AND s.deleted_at IS NULL
      WHERE c.id = ${commentId} AND c.deleted_at IS NULL AND r.deleted_at IS NULL
      FOR UPDATE OF r
    `);
    if (parents.length === 0) return [];
    // 리뷰 잠금을 기다리는 사이 댓글이 지워졌을 수 있어 잠근 뒤 다시 본다
    return tx.$queryRaw<ReportTargetRow[]>(Prisma.sql`
      SELECT c.id, c.account_id, c.content
      FROM review_comment c
      WHERE c.id = ${commentId} AND c.deleted_at IS NULL
      FOR UPDATE
    `);
  }
}
