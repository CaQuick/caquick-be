import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsIn,
  IsString,
  ValidateIf,
} from 'class-validator';

import {
  ADMIN_NOTIFICATION_TARGET_KINDS,
  ADMIN_NOTIFICATION_TYPES,
  MAX_NOTIFICATION_ACCOUNT_IDS,
  type AdminNotificationTargetKindValue,
  type AdminNotificationTypeValue,
} from '@/features/admin/constants/admin.constants';

/** 길이·공백 정리는 service(cleanRequiredText)가 담당. */
export class AdminSendNotificationInput {
  @IsIn(ADMIN_NOTIFICATION_TYPES)
  type!: AdminNotificationTypeValue;

  @IsString()
  title!: string;

  @IsString()
  body!: string;

  @IsIn(ADMIN_NOTIFICATION_TARGET_KINDS)
  targetKind!: AdminNotificationTargetKindValue;

  /** ACCOUNT_IDS일 때만 검증한다 — ALL_USERS면 무시. */
  @ValidateIf((o: AdminSendNotificationInput) => o.targetKind === 'ACCOUNT_IDS')
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_NOTIFICATION_ACCOUNT_IDS)
  @IsString({ each: true })
  accountIds?: string[] | null;
}
