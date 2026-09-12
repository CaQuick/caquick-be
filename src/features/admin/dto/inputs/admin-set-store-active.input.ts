import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_REASON_LENGTH } from '@/features/admin/constants/admin.constants';

export class AdminSetStoreActiveInput {
  @IsString()
  storeId!: string;

  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason?: string | null;
}
