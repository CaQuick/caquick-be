import { IsDate, IsOptional, IsString } from 'class-validator';

export class SellerRescheduleOrderPickupInput {
  @IsString()
  orderId!: string;

  // 영업일·슬롯·수량은 매장 픽업 판정과 capacity 재검사가 본다
  @IsDate()
  pickupAt!: Date;

  @IsOptional()
  @IsString()
  note?: string | null;
}
