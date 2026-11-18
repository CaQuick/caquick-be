import { IsEnum, IsOptional } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import { DepositRecordKind } from '@/generated/prisma/client';

export class AdminDepositRecordListInput extends CursorInput {
  @IsOptional()
  @IsEnum(DepositRecordKind)
  kind?: DepositRecordKind | null;
}
