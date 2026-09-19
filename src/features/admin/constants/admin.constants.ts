import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';

// ── 리뷰 모더레이션 ──

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

// ── 주문 ──

export const ORDER_STATUSES = [
  'SUBMITTED',
  'CONFIRMED',
  'MADE',
  'PICKED_UP',
  'CANCELED',
] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];
/** 관리자 취소 이력 메모 접두 — 판매자 취소와 구분한다. */
export const ADMIN_CANCEL_NOTE_PREFIX = '[관리자] ';
/** 접두를 붙인 뒤에도 order_status_history.note(500)에 들어가야 한다. */
export const MAX_ADMIN_CANCEL_NOTE_LENGTH =
  MAX_REASON_LENGTH - ADMIN_CANCEL_NOTE_PREFIX.length;

// ── 알림 발송 ──

export const ADMIN_NOTIFICATION_TYPES = ['SYSTEM', 'MARKETING'] as const;
export type AdminNotificationTypeValue =
  (typeof ADMIN_NOTIFICATION_TYPES)[number];
export const ADMIN_NOTIFICATION_TARGET_KINDS = [
  'ALL_USERS',
  'ACCOUNT_IDS',
] as const;
export type AdminNotificationTargetKindValue =
  (typeof ADMIN_NOTIFICATION_TARGET_KINDS)[number];
export const MAX_NOTIFICATION_TITLE_LENGTH = 200;
export const MAX_NOTIFICATION_BODY_LENGTH = 2000;
export const MAX_NOTIFICATION_ACCOUNT_IDS = 500;
/** 전체 발송 fan-out 청크. 청크 단위 createMany이고 청크 사이 트랜잭션은 없다. */
export const NOTIFICATION_FANOUT_BATCH_SIZE = 1000;

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
