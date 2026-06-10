import { IsBoolean, IsOptional, IsString } from 'class-validator';

import { SellerCursorInput } from '@/features/seller/dto/inputs/seller-cursor.input';

export class SellerProductListInput extends SellerCursorInput {
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
