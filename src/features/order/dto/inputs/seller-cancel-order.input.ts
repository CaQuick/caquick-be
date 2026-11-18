import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

import { OrderCancelFault, OrderCancelReason } from '@/generated/prisma/client';

export class SellerCancelOrderInput {
  @IsString()
  orderId!: string;

  // 주문 상태별 허용 여부는 OrderCancelPolicy가 판정한다
  @IsEnum(OrderCancelReason)
  reason!: OrderCancelReason;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsOptional()
  @IsEnum(OrderCancelFault)
  fault?: OrderCancelFault | null;

  // 범위(0~결제액)는 잠금 뒤 결제액으로 판정한다
  @IsOptional()
  @IsInt()
  refundAmount?: number | null;
}
