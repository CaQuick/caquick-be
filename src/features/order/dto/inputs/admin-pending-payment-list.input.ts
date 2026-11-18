import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';

export class AdminPendingPaymentListInput extends CursorInput {
  @IsOptional()
  @IsBoolean()
  claimedOnly?: boolean;

  @IsOptional()
  @IsInt()
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  depositorName?: string;
}
