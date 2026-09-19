export const DEFAULT_REVIEWS_LIMIT = 20;

export const REVIEW_SORTS = ['LATEST', 'LIKES'] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

/** 작성자가 대상을 지워 신고가 무의미해졌을 때 닫으며 남기는 메모. */
export const REVIEW_REPORT_CLOSED_BY_AUTHOR_NOTE = '작성자가 대상을 삭제함';

// ── 관리자 모더레이션 입력 ──

export const REVIEW_REPORT_STATUSES = [
  'PENDING',
  'RESOLVED',
  'REJECTED',
] as const;
export type ReviewReportStatusValue = (typeof REVIEW_REPORT_STATUSES)[number];
export const REVIEW_REPORT_TARGET_TYPES = ['REVIEW', 'REVIEW_COMMENT'] as const;
export type ReviewReportTargetTypeValue =
  (typeof REVIEW_REPORT_TARGET_TYPES)[number];
export const REVIEW_REPORT_ACTIONS = ['DELETE_TARGET', 'REJECT'] as const;
export type ReviewReportActionValue = (typeof REVIEW_REPORT_ACTIONS)[number];
