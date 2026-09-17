import { anonymizeReviewAuthor } from '@/common/utils/review-author';
import type {
  AdminReviewCommentRow,
  AdminReviewReportDetailRow,
  AdminReviewRow,
} from '@/features/admin/repositories/admin.repository';
import type {
  AdminReviewCommentOutput,
  AdminReviewOutput,
  AdminReviewReportDetailOutput,
  AdminReviewReportOutput,
} from '@/features/admin/types/admin-output.type';

/** 작성자 노출 정책은 common 헬퍼가 단일 소스(리뷰 화면과 동일). */
function nicknameOf(account: {
  user_profile: { nickname: string; deleted_at: Date | null } | null;
}): string | null {
  return anonymizeReviewAuthor(account.user_profile).nickname;
}

export function toAdminReviewReportOutput(row: {
  id: bigint;
  review_id: bigint | null;
  review_comment_id: bigint | null;
  reporter_account_id: bigint;
  reason: AdminReviewReportOutput['reason'];
  detail: string | null;
  content_snapshot: string | null;
  status: AdminReviewReportOutput['status'];
  resolved_by_account_id: bigint | null;
  resolved_at: Date | null;
  resolution_note: string | null;
  created_at: Date;
}): AdminReviewReportOutput {
  const isComment = row.review_comment_id !== null;
  return {
    id: row.id.toString(),
    targetType: isComment ? 'REVIEW_COMMENT' : 'REVIEW',
    // 서비스가 둘 중 하나를 보장한다
    targetId: (isComment ? row.review_comment_id! : row.review_id!).toString(),
    reporterAccountId: row.reporter_account_id.toString(),
    reason: row.reason,
    detail: row.detail,
    contentSnapshot: row.content_snapshot,
    status: row.status,
    resolvedByAccountId: row.resolved_by_account_id?.toString() ?? null,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
  };
}

export function toAdminReviewReportDetailOutput(
  row: AdminReviewReportDetailRow,
): AdminReviewReportDetailOutput | null {
  const report = toAdminReviewReportOutput(row);
  if (row.review_comment) {
    const c = row.review_comment;
    return {
      report,
      target: {
        id: c.id.toString(),
        reviewId: c.review_id.toString(),
        authorAccountId: c.account_id.toString(),
        authorNickname: nicknameOf(c.account),
        content: c.content,
        storeId: c.review.store_id.toString(),
        deleted: c.deleted_at !== null,
      },
    };
  }
  if (row.review) {
    const r = row.review;
    return {
      report,
      target: {
        id: r.id.toString(),
        reviewId: null,
        authorAccountId: r.account_id.toString(),
        authorNickname: nicknameOf(r.account),
        content: r.content,
        storeId: r.store_id.toString(),
        deleted: r.deleted_at !== null,
      },
    };
  }
  // 대상이 하드 삭제된 비정상 데이터 — 상세를 만들 수 없다
  return null;
}

export function toAdminReviewOutput(row: AdminReviewRow): AdminReviewOutput {
  return {
    id: row.id.toString(),
    storeId: row.store_id.toString(),
    storeName: row.store.store_name,
    productId: row.product_id.toString(),
    authorAccountId: row.account_id.toString(),
    authorNickname: nicknameOf(row.account),
    rating: Number(row.rating),
    content: row.content,
    commentCount: row._count.comments,
    likeCount: row._count.likes,
    deleted: row.deleted_at !== null,
    createdAt: row.created_at,
  };
}

export function toAdminReviewCommentOutput(
  row: AdminReviewCommentRow,
): AdminReviewCommentOutput {
  return {
    id: row.id.toString(),
    reviewId: row.review_id.toString(),
    authorAccountId: row.account_id.toString(),
    authorNickname: nicknameOf(row.account),
    content: row.content,
    deleted: row.deleted_at !== null,
    createdAt: row.created_at,
  };
}
