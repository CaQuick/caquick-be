import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';

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
