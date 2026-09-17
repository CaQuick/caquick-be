import { IsDate, IsIn, IsOptional, IsString } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';

const ORDER_STATUSES = [
  'SUBMITTED',
  'CONFIRMED',
  'MADE',
  'PICKED_UP',
  'CANCELED',
] as const;
type SellerOrderStatusInput = (typeof ORDER_STATUSES)[number];

export class SellerOrderListInput extends CursorInput {
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: SellerOrderStatusInput;

  @IsOptional()
  @IsDate()
  fromCreatedAt?: Date;

  @IsOptional()
  @IsDate()
  toCreatedAt?: Date;

  @IsOptional()
  @IsDate()
  fromPickupAt?: Date;

  @IsOptional()
  @IsDate()
  toPickupAt?: Date;

  @IsOptional()
  @IsString()
  search?: string;
}
