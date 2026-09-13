import { IsDate, IsIn, IsOptional, IsString } from 'class-validator';

import {
  AUDIT_ACTION_TYPES,
  AUDIT_TARGET_TYPES,
  type AuditActionTypeValue,
  type AuditTargetTypeValue,
} from '@/features/admin/constants/admin.constants';
import { AdminCursorInput } from '@/features/admin/dto/inputs/admin-cursor.input';

export class AdminAuditLogListInput extends AdminCursorInput {
  @IsOptional()
  @IsString()
  actorAccountId?: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsIn(AUDIT_TARGET_TYPES)
  targetType?: AuditTargetTypeValue;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsIn(AUDIT_ACTION_TYPES)
  action?: AuditActionTypeValue;

  @IsOptional()
  @IsDate()
  fromCreatedAt?: Date;

  @IsOptional()
  @IsDate()
  toCreatedAt?: Date;
}
