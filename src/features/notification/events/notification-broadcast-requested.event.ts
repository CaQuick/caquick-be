import {
  ADMIN_NOTIFICATION_TYPES,
  type AdminNotificationTypeValue,
} from '@/features/notification/constants/notification-admin.constants';
import type { OutboxEventInput } from '@/features/outbox';
import type { Prisma } from '@/generated/prisma/client';

/**
 * 관리자 일괄 발송 요청. 이벤트 1건 + 소비자 fan-out(§0). 대상은 요청 시점에 확정한다 —
 * ACCOUNT_IDS는 목록(최대 500)을, ALL_USERS는 전원을 싣지 않고 요청 시점 컷오프(maxAccountId)와 건수만 싣고
 * 소비자가 그 컷오프 이하 활성 USER를 페이지로 훑는다(대상이 커도 payload·메모리가 유계).
 * sentCount가 "대상 확정 건수"가 되고, 재생(같은 멱등 키)이 같은 응답을 돌려줄 수 있다.
 */
export const NOTIFICATION_BROADCAST_REQUESTED =
  'notification.broadcast_requested';

/** 같은 관리자·같은 idempotencyKey → 같은 event_id(uuid v5). */
export const NOTIFICATION_BROADCAST_NAMESPACE =
  '3f6d1a2e-7c4b-5e8a-9d0f-2b1c3d4e5f60';

export type BroadcastAudience =
  | { kind: 'ACCOUNT_IDS'; accountIds: string[] }
  | { kind: 'ALL_USERS'; maxAccountId: string; count: number };

export interface NotificationBroadcastRequestedPayload {
  type: AdminNotificationTypeValue;
  title: string;
  body: string;
  audience: BroadcastAudience;
  skippedAccountIds: string[];
}

export function audienceCount(audience: BroadcastAudience): number {
  return audience.kind === 'ACCOUNT_IDS'
    ? audience.accountIds.length
    : audience.count;
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

function parseAudience(value: unknown): BroadcastAudience | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const a = value as Partial<{
    kind: unknown;
    accountIds: unknown;
    maxAccountId: unknown;
    count: unknown;
  }>;
  if (a.kind === 'ACCOUNT_IDS' && isStringArray(a.accountIds)) {
    return { kind: 'ACCOUNT_IDS', accountIds: a.accountIds };
  }
  if (
    a.kind === 'ALL_USERS' &&
    typeof a.maxAccountId === 'string' &&
    Number.isSafeInteger(a.count) &&
    (a.count as number) >= 0
  ) {
    return {
      kind: 'ALL_USERS',
      maxAccountId: a.maxAccountId,
      count: a.count as number,
    };
  }
  return null;
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
    !isStringArray(p.skippedAccountIds)
  ) {
    throw new Error(`${NOTIFICATION_BROADCAST_REQUESTED} payload 형식 오류`);
  }
  const audience = parseAudience(p.audience);
  if (!audience) {
    throw new Error(`${NOTIFICATION_BROADCAST_REQUESTED} payload 형식 오류`);
  }
  return {
    type: p.type as AdminNotificationTypeValue,
    title: p.title,
    body: p.body,
    audience,
    skippedAccountIds: p.skippedAccountIds,
  };
}
