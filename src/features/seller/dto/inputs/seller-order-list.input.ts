import { IsDate, IsIn, IsOptional, IsString } from 'class-validator';

import { SellerCursorInput } from '@/features/seller/dto/inputs/seller-cursor.input';

const ORDER_STATUSES = [
  'SUBMITTED',
  'CONFIRMED',
  'MADE',
  'PICKED_UP',
  'CANCELED',
] as const;
type SellerOrderStatusInput = (typeof ORDER_STATUSES)[number];

export class SellerOrderListInput extends SellerCursorInput {
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
