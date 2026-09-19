import { IsIn, IsOptional } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import {
  SELLER_AUDIT_TARGET_TYPES,
  type SellerAuditTargetType,
} from '@/features/audit-log';

export class SellerAuditLogListInput extends CursorInput {
  @IsOptional()
  @IsIn(SELLER_AUDIT_TARGET_TYPES)
  targetType?: SellerAuditTargetType;
}
