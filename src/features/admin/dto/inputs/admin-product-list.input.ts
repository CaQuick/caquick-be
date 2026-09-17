import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import { MAX_KEYWORD_LENGTH } from '@/features/admin/constants/admin.constants';

export class AdminProductListInput extends CursorInput {
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
