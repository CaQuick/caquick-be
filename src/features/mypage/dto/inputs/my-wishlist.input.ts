import { IsOptional, IsString } from 'class-validator';

import { UserPaginationInput } from '@/common/dto/inputs/user-pagination.input';

export class MyWishlistInput extends UserPaginationInput {
  @IsOptional()
  @IsString()
  storeId?: string;
}
