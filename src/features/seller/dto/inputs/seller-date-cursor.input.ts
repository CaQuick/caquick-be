import { IsDate, IsOptional } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';

export class SellerDateCursorInput extends CursorInput {
  @IsOptional()
  @IsDate()
  fromDate?: Date;

  @IsOptional()
  @IsDate()
  toDate?: Date;
}
