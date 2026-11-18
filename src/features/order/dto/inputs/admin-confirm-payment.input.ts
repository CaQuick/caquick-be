import { IsInt, IsOptional, IsString } from 'class-validator';

export class AdminConfirmPaymentInput {
  @IsString()
  orderId!: string;

  // 음수는 서비스가 DEPOSIT_AMOUNT_INVALID로 거절한다(0원 주문은 0으로 확인)
  @IsInt()
  depositedAmount!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
