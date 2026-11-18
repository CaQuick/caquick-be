import { IsEnum, IsOptional, IsString } from 'class-validator';

import { OrderStatus } from '@/generated/prisma/client';

export class SellerUpdateOrderStatusInput {
  @IsString()
  orderId!: string;

  // 전이 가능 여부는 정책(assertTransition)이 판정한다
  @IsEnum(OrderStatus)
  toStatus!: OrderStatus;

  @IsOptional()
  @IsString()
  note?: string | null;
}
