import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { MAX_PAGINATION_LIMIT } from '@/features/user/constants/user.constants';

export class MyNotificationsInput {
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGINATION_LIMIT)
  limit?: number;
}
