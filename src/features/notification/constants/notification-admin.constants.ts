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

// ── 발송 이력 ──

export const ADMIN_NOTIFICATION_BROADCAST_STATUSES = [
  'IN_PROGRESS',
  'COMPLETED',
  'DELAYED',
] as const;
export type AdminNotificationBroadcastStatusValue =
  (typeof ADMIN_NOTIFICATION_BROADCAST_STATUSES)[number];
/** 요청 뒤 이만큼 지나도 완료 기록이 없으면 지연으로 본다 — DLQ로 빠진 발송은 소비자가 알릴 수 없어 시간으로 판정한다. */
export const NOTIFICATION_BROADCAST_DELAY_MS = 30 * 60 * 1000;
