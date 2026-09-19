// ── 리뷰 댓글 ──

export const MAX_REVIEW_COMMENT_LENGTH = 500;

// ── 알림 ──

// "최근 3개월 내의 알림만 확인할 수 있어요." — 삭제가 아니라 조회 필터로만 강제한다.
export const NOTIFICATION_VISIBLE_MONTHS = 3;

// ── 리뷰·댓글 신고 ──

export const REVIEW_REPORT_REASONS = [
  'SPAM',
  'ABUSE',
  'INAPPROPRIATE',
  'OTHER',
] as const;
export type ReviewReportReasonValue = (typeof REVIEW_REPORT_REASONS)[number];
export const MAX_REVIEW_REPORT_DETAIL_LENGTH = 500;
export const MAX_REVIEW_REPORT_SNAPSHOT_LENGTH = 2000;
