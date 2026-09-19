import {
  ADMIN_NOTIFICATION_TYPES,
  type AdminNotificationTypeValue,
} from '@/features/notification/constants/notification-admin.constants';
import type { OutboxEventInput } from '@/features/outbox';
import type { Prisma } from '@/generated/prisma/client';

/**
 * 관리자 일괄 발송 요청. 이벤트 1건 + 소비자 fan-out(§0). 대상은 요청 시점에 확정해 payload에 싣는다 —
 * sentCount가 "대상 확정 건수"가 되고, 재생(같은 멱등 키)이 같은 응답을 돌려줄 수 있다.
 */
export const NOTIFICATION_BROADCAST_REQUESTED =
  'notification.broadcast_requested';

/** 같은 관리자·같은 idempotencyKey → 같은 event_id(uuid v5). */
export const NOTIFICATION_BROADCAST_NAMESPACE =
  '3f6d1a2e-7c4b-5e8a-9d0f-2b1c3d4e5f60';

export interface NotificationBroadcastRequestedPayload {
  type: AdminNotificationTypeValue;
  title: string;
  body: string;
  targetAccountIds: string[];
  skippedAccountIds: string[];
}

export function notificationBroadcastRequestedEvent(args: {
  eventId: string;
  actorAccountId: bigint;
  payload: NotificationBroadcastRequestedPayload;
}): OutboxEventInput & { eventId: string } {
  return {
    eventId: args.eventId,
    aggregateType: 'notification-broadcast',
    aggregateId: args.eventId,
    eventType: NOTIFICATION_BROADCAST_REQUESTED,
    payload: { ...args.payload },
    actorAccountId: args.actorAccountId,
  };
}

const TYPES = new Set<string>(ADMIN_NOTIFICATION_TYPES);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** 소비자용 방어적 파싱 — 형태가 어긋난 payload는 던져서 재시도·FAILED로 드러낸다. */
export function parseNotificationBroadcastRequestedPayload(
  value: Prisma.JsonValue,
): NotificationBroadcastRequestedPayload {
  const p = value as Partial<
    Record<keyof NotificationBroadcastRequestedPayload, unknown>
  >;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof p.type !== 'string' ||
    !TYPES.has(p.type) ||
    typeof p.title !== 'string' ||
    typeof p.body !== 'string' ||
    !isStringArray(p.targetAccountIds) ||
    !isStringArray(p.skippedAccountIds)
  ) {
    throw new Error(`${NOTIFICATION_BROADCAST_REQUESTED} payload 형식 오류`);
  }
  return {
    type: p.type as AdminNotificationTypeValue,
    title: p.title,
    body: p.body,
    targetAccountIds: p.targetAccountIds,
    skippedAccountIds: p.skippedAccountIds,
  };
}
