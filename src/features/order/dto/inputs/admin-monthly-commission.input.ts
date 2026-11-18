import { IsString } from 'class-validator';

export class AdminMonthlyCommissionInput {
  // 형식(YYYY-MM)은 서비스가 INVALID_YEAR_MONTH로 거절한다
  @IsString()
  month!: string;
}
