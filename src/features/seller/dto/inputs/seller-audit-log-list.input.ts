import { IsIn, IsOptional } from 'class-validator';

import {
  SELLER_AUDIT_TARGET_TYPES,
  type SellerAuditTargetType,
} from '@/features/seller/constants/seller.constants';
import { SellerCursorInput } from '@/features/seller/dto/inputs/seller-cursor.input';

export class SellerAuditLogListInput extends SellerCursorInput {
  @IsOptional()
  @IsIn(SELLER_AUDIT_TARGET_TYPES)
  targetType?: SellerAuditTargetType;
}
