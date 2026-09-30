import type {
  AdminNotificationBroadcastStatusValue,
  AdminNotificationTargetKindValue,
  AdminNotificationTypeValue,
} from '@/features/notification/constants/notification-admin.constants';

export interface AdminSendNotificationResultOutput {
  sentCount: number;
  skippedAccountIds: string[];
  broadcastId: string;
}

export interface AdminNotificationBroadcastOutput {
  id: string;
  type: AdminNotificationTypeValue;
  title: string;
  body: string;
  targetKind: AdminNotificationTargetKindValue;
  targetCount: number;
  skippedCount: number;
  deliveredCount: number;
  status: AdminNotificationBroadcastStatusValue;
  actorAccountId: string;
  actorLabel: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  targetAccountIds: string[];
  skippedAccountIds: string[];
}
