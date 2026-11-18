import { IsInt, IsOptional, IsString } from 'class-validator';

export class AdminConfirmPaymentInput {
  @IsString()
  orderId!: string;

  // 1원 미만은 서비스가 DEPOSIT_AMOUNT_INVALID로 거절한다
  @IsInt()
  depositedAmount!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
