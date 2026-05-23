import { IsIn, IsOptional } from 'class-validator';

import { SellerCursorInput } from '@/features/seller/dto/inputs/seller-cursor.input';

const AUDIT_TARGET_TYPES = [
  'STORE',
  'PRODUCT',
  'ORDER',
  'CONVERSATION',
  'CHANGE_PASSWORD',
] as const;
type SellerAuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export class SellerAuditLogListInput extends SellerCursorInput {
  @IsOptional()
  @IsIn(AUDIT_TARGET_TYPES)
  targetType?: SellerAuditTargetType;
}
