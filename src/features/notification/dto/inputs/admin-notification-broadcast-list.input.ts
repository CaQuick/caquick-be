import { IsIn, IsOptional } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import {
  ADMIN_NOTIFICATION_TARGET_KINDS,
  ADMIN_NOTIFICATION_TYPES,
  type AdminNotificationTargetKindValue,
  type AdminNotificationTypeValue,
} from '@/features/notification/constants/notification-admin.constants';

export class AdminNotificationBroadcastListInput extends CursorInput {
  @IsOptional()
  @IsIn(ADMIN_NOTIFICATION_TYPES)
  type?: AdminNotificationTypeValue | null;

  @IsOptional()
  @IsIn(ADMIN_NOTIFICATION_TARGET_KINDS)
  targetKind?: AdminNotificationTargetKindValue | null;
}
