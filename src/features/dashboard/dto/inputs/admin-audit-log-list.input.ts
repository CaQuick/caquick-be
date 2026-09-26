import { IsDate, IsIn, IsOptional, IsString } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import {
  AUDIT_ACTION_TYPES,
  AUDIT_TARGET_TYPES,
  type AuditActionTypeValue,
  type AuditTargetTypeValue,
} from '@/features/dashboard/constants/dashboard.constants';

export class AdminAuditLogListInput extends CursorInput {
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
