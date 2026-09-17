import { IsDate, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import {
  MAX_KEYWORD_LENGTH,
  ORDER_STATUSES,
  type OrderStatusValue,
} from '@/features/admin/constants/admin.constants';

export class AdminOrderListInput extends CursorInput {
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
