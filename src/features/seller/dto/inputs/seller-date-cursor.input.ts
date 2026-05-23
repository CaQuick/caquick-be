import { IsDate, IsOptional } from 'class-validator';

import { SellerCursorInput } from '@/features/seller/dto/inputs/seller-cursor.input';

export class SellerDateCursorInput extends SellerCursorInput {
  @IsOptional()
  @IsDate()
  fromDate?: Date;

  @IsOptional()
  @IsDate()
  toDate?: Date;
}
