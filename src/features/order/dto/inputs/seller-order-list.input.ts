import { IsDate, IsEnum, IsOptional, IsString } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import { OrderStatus } from '@/generated/prisma/client';

export class SellerOrderListInput extends CursorInput {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  buyerAccountId?: string;

  @IsOptional()
  @IsDate()
  fromCreatedAt?: Date;

  @IsOptional()
  @IsDate()
  toCreatedAt?: Date;

  @IsOptional()
  @IsDate()
  fromPickupAt?: Date;

  @IsOptional()
  @IsDate()
  toPickupAt?: Date;

  @IsOptional()
  @IsString()
  search?: string;
}
