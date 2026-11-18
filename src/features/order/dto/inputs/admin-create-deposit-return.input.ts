import { IsDate, IsInt, IsOptional, IsString } from 'class-validator';

// 금액 하한·입금자명 길이는 서비스가 도메인 오류 코드로 거절한다
export class AdminCreateDepositReturnInput {
  @IsString()
  orderId!: string;

  @IsInt()
  amount!: number;

  @IsString()
  depositorName!: string;

  @IsOptional()
  @IsDate()
  depositedAt?: Date | null;

  @IsOptional()
  @IsString()
  note?: string | null;
}
