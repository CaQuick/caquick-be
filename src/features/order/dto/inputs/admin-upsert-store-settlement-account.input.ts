import { IsString, MaxLength } from 'class-validator';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';

// 은행·계좌번호·예금주 형식은 서비스가 도메인 오류 코드로 거절한다
export class AdminUpsertStoreSettlementAccountInput {
  @IsString()
  storeId!: string;

  @IsString()
  bankCode!: string;

  @IsString()
  accountHolder!: string;

  @IsString()
  accountNumber!: string;

  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason!: string;
}
