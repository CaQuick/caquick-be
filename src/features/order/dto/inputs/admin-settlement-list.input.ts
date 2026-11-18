import { IsEnum, IsOptional, IsString } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import { SettlementStatus } from '@/generated/prisma/client';

export class AdminSettlementListInput extends CursorInput {
  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;

  @IsOptional()
  @IsString()
  storeId?: string;

  // 형식(YYYY-MM-DD)은 서비스가 INVALID_DATE로 거절한다
  @IsOptional()
  @IsString()
  periodStart?: string;
}
