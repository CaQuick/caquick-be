import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  ACCOUNT_STATUSES,
  MAX_KEYWORD_LENGTH,
  type AccountStatusValue,
} from '@/features/admin/constants/admin.constants';
import { AdminCursorInput } from '@/features/admin/dto/inputs/admin-cursor.input';

export class AdminUserListInput extends AdminCursorInput {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_KEYWORD_LENGTH)
  keyword?: string;

  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatusValue;
}
