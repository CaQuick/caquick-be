import { IsString } from 'class-validator';

// 은행·계좌번호·예금주 형식은 서비스가 도메인 오류 코드로 거절한다
export class SellerUpsertSettlementAccountInput {
  @IsString()
  bankCode!: string;

  @IsString()
  accountHolder!: string;

  @IsString()
  accountNumber!: string;
}
