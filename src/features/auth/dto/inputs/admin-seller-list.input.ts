import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_KEYWORD_LENGTH } from '@/common/constants/list-search.constants';
import { CursorInput } from '@/common/dto/inputs/cursor.input';
import {
  ACCOUNT_STATUSES,
  type AccountStatusValue,
} from '@/features/auth/constants/auth-admin.constants';

export class AdminSellerListInput extends CursorInput {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_KEYWORD_LENGTH)
  keyword?: string;

  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatusValue;
}
