import { IsBoolean, IsOptional } from 'class-validator';

import { UserPaginationInput } from '@/features/user/dto/inputs/user-pagination.input';

export class MyNotificationsInput extends UserPaginationInput {
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;
}
