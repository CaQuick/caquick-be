// ── 감사 로그 ──

export const AUDIT_TARGET_TYPES = [
  'STORE',
  'PRODUCT',
  'ORDER',
  'CONVERSATION',
  'CHANGE_PASSWORD',
  'ACCOUNT',
  'BANNER',
  'CATEGORY',
  'TAG',
  'REGION',
  'REVIEW',
  'REVIEW_COMMENT',
  'REVIEW_REPORT',
  'NOTIFICATION',
] as const;
export type AuditTargetTypeValue = (typeof AUDIT_TARGET_TYPES)[number];
export const AUDIT_ACTION_TYPES = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'STATUS_CHANGE',
] as const;
export type AuditActionTypeValue = (typeof AUDIT_ACTION_TYPES)[number];

// ── 대시보드 ──

export const MAX_DASHBOARD_RANGE_DAYS = 366;
