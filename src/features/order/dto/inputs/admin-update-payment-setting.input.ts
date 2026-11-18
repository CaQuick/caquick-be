import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';

// 범위·은행·계좌 형식은 서비스가 도메인 오류 코드로 거절한다
export class AdminUpdatePaymentSettingInput {
  @IsOptional()
  @IsInt()
  commissionRateBps?: number | null;

  @IsOptional()
  @IsString()
  depositBankCode?: string | null;

  @IsOptional()
  @IsString()
  depositAccountNumber?: string | null;

  @IsOptional()
  @IsString()
  depositAccountHolder?: string | null;

  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason!: string;
}
