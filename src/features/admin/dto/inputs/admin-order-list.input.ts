import { IsDate, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  MAX_KEYWORD_LENGTH,
  ORDER_STATUSES,
  type OrderStatusValue,
} from '@/features/admin/constants/admin.constants';
import { AdminCursorInput } from '@/features/admin/dto/inputs/admin-cursor.input';

export class AdminOrderListInput extends AdminCursorInput {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_KEYWORD_LENGTH)
  keyword?: string;

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatusValue;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsDate()
  fromCreatedAt?: Date;

  @IsOptional()
  @IsDate()
  toCreatedAt?: Date;
}
