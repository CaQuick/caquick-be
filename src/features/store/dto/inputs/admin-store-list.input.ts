import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_KEYWORD_LENGTH } from '@/common/constants/list-search.constants';
import { CursorInput } from '@/common/dto/inputs/cursor.input';

export class AdminStoreListInput extends CursorInput {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_KEYWORD_LENGTH)
  keyword?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  regionId?: string;
}
