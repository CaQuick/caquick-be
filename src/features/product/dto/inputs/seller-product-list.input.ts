import { IsBoolean, IsOptional, IsString } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';

export class SellerProductListInput extends CursorInput {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
