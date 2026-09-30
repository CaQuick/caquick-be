import {
  type AdminNotificationBroadcastStatusValue,
  type AdminNotificationTypeValue,
  NOTIFICATION_BROADCAST_DELAY_MS,
} from '@/features/notification/constants/notification-admin.constants';
import type { AdminNotificationBroadcastOutput } from '@/features/notification/types/notification-admin-output.type';
import type { NotificationBroadcast, Prisma } from '@/generated/prisma/client';

/** 완료 기록이 있으면 완료, 없으면 요청 뒤 30분(포함)부터 지연. */
export function broadcastStatus(
  completedAt: Date | null,
  requestedAt: Date,
  now: Date,
): AdminNotificationBroadcastStatusValue {
  if (completedAt !== null) return 'COMPLETED';
  return now.getTime() - requestedAt.getTime() >=
    NOTIFICATION_BROADCAST_DELAY_MS
    ? 'DELAYED'
    : 'IN_PROGRESS';
}

/** 완료 때 다시 센 저장 수가 있으면 그 값을 쓰고, 아니면 조회 때 센 값이 필요하다. */
export function needsLiveDeliveredCount(row: NotificationBroadcast): boolean {
  return row.completed_at === null || row.delivered_count === null;
}

/** 저장된 ID 배열(JSON). 형태가 어긋나면 빈 배열로 본다. */
export function toIdList(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

export function toAdminNotificationBroadcastOutput(
  row: NotificationBroadcast,
  liveDelivered: ReadonlyMap<string, number>,
  now: Date,
): AdminNotificationBroadcastOutput {
  return {
    id: row.id.toString(),
    // 이력은 관리자 발송만 기록한다(SYSTEM·MARKETING)
    type: row.type as AdminNotificationTypeValue,
    title: row.title,
    body: row.body,
    targetKind: row.target_kind,
    targetCount: row.target_count,
    skippedCount: row.skipped_count,
    deliveredCount: needsLiveDeliveredCount(row)
      ? (liveDelivered.get(row.event_id) ?? 0)
      : (row.delivered_count ?? 0),
    status: broadcastStatus(row.completed_at, row.created_at, now),
    actorAccountId: row.actor_account_id.toString(),
    actorLabel: row.actor_label,
    requestedAt: row.created_at,
    completedAt: row.completed_at,
    targetAccountIds: toIdList(row.target_account_ids),
    skippedAccountIds: toIdList(row.skipped_account_ids),
  };
}
