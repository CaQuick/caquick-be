import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import {
  ACCOUNT_STATUSES,
  MAX_KEYWORD_LENGTH,
  type AccountStatusValue,
} from '@/features/admin/constants/admin.constants';

export class AdminSellerListInput extends CursorInput {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_KEYWORD_LENGTH)
  keyword?: string;

  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatusValue;
}
