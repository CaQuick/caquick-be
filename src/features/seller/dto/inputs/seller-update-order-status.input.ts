import { IsIn, IsOptional, IsString } from 'class-validator';

const ORDER_STATUSES = [
  'SUBMITTED',
  'CONFIRMED',
  'MADE',
  'PICKED_UP',
  'CANCELED',
] as const;
type SellerOrderStatusInput = (typeof ORDER_STATUSES)[number];

export class SellerUpdateOrderStatusInput {
  @IsString()
  orderId!: string;

  @IsIn(ORDER_STATUSES)
  toStatus!: SellerOrderStatusInput;

  @IsOptional()
  @IsString()
  note?: string | null;
}
