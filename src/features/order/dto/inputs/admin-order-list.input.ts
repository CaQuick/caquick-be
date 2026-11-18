import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { MAX_KEYWORD_LENGTH } from '@/common/constants/list-search.constants';
import { CursorInput } from '@/common/dto/inputs/cursor.input';
import { OrderStatus } from '@/generated/prisma/client';

export class AdminOrderListInput extends CursorInput {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_KEYWORD_LENGTH)
  keyword?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsBoolean()
  inProgress?: boolean;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsDate()
  fromCreatedAt?: Date;

  @IsOptional()
  @IsDate()
  toCreatedAt?: Date;
}
