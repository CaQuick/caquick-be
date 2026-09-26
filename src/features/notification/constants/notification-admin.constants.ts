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
