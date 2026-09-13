import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_KEYWORD_LENGTH } from '@/features/admin/constants/admin.constants';
import { AdminCursorInput } from '@/features/admin/dto/inputs/admin-cursor.input';

export class AdminProductListInput extends AdminCursorInput {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_KEYWORD_LENGTH)
  keyword?: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
