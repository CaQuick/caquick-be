import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_KEYWORD_LENGTH } from '@/common/constants/list-search.constants';
import { CursorInput } from '@/common/dto/inputs/cursor.input';

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
