import { IsDate, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_KEYWORD_LENGTH } from '@/common/constants/list-search.constants';
import { CursorInput } from '@/common/dto/inputs/cursor.input';
import {
  ORDER_STATUSES,
  type OrderStatusValue,
} from '@/features/order/constants/order-admin.constants';

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
