import { Prisma } from '@/generated/prisma/client';

/** 행 잠금 대상 review 테이블. 고정 문자열만 raw로 들어간다. */
export type ReviewLockTable = 'review' | 'review_comment' | 'review_report';

/**
 * 대상 행을 잠그고(FOR UPDATE) 미삭제인지 확인한다. 읽고-쓰는 조작(수정·삭제·신고 처리)은 이 잠금
 * 뒤에 트랜잭션 안에서 다시 읽어야 한다 — 미리 읽은 값은 다른 커밋으로 낡을 수 있다.
 */
export async function lockActiveReviewRow(
  tx: Prisma.TransactionClient,
  table: ReviewLockTable,
  id: bigint,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM ${Prisma.raw(table)}
    WHERE id = ${id} AND deleted_at IS NULL
    FOR UPDATE`;
  return rows.length > 0;
}

/**
 * 댓글을 잠그기 전에 부모 리뷰부터 잠근다(리뷰 → 댓글 → 신고). 리뷰 삭제 경로(관리자·작성자)가
 * 리뷰를 잠근 뒤 신고·댓글을 닫으므로, 댓글부터 잠그면 신고 행을 사이에 두고 교착한다.
 * 리뷰가 이미 삭제됐어도 잠근다 — 순서만 맞으면 된다.
 */
export async function lockParentReviewOfComment(
  tx: Prisma.TransactionClient,
  commentId: bigint,
): Promise<void> {
  await tx.$queryRaw`
    SELECT r.id FROM review r
    JOIN review_comment c ON c.review_id = r.id
    WHERE c.id = ${commentId}
    FOR UPDATE OF r`;
}

/**
 * 대상을 겨냥한 PENDING 신고를 일괄 종결한다 — 작성자 삭제(처리자 없음)와 관리자 삭제(처리자 기록)가
 * 같은 1벌을 쓴다. 대상이 사라진 신고를 열어 두면 같은 id가 재작성으로 복원될 때 새 내용에 붙는다.
 */
export async function resolvePendingReports(
  tx: Prisma.TransactionClient,
  args: {
    where: Prisma.ReviewReportWhereInput;
    now: Date;
    resolvedByAccountId: bigint | null;
    note: string;
  },
): Promise<number> {
  const result = await tx.reviewReport.updateMany({
    where: { status: 'PENDING', ...args.where },
    data: {
      status: 'RESOLVED',
      // 종결과 함께 unique 키를 비운다 — 같은 대상을 다시 신고할 수 있어야 한다
      open_key: null,
      resolved_by_account_id: args.resolvedByAccountId,
      resolved_at: args.now,
      resolution_note: args.note,
      updated_at: args.now,
    },
  });
  return result.count;
}
