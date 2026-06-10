import { OrderStatus } from '@prisma/client';
import { IsArray, IsEnum, IsOptional } from 'class-validator';

import { UserPaginationInput } from '@/features/user/dto/inputs/user-pagination.input';

export class MyOrdersInput extends UserPaginationInput {
  @IsOptional()
  @IsArray()
  @IsEnum(OrderStatus, { each: true })
  statuses?: OrderStatus[];
}
