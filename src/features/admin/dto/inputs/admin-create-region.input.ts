import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

import {
  MAX_REGION_NAME_LENGTH,
  MAX_REGION_SLUG_LENGTH,
  REGION_SLUG_PATTERN,
} from '@/features/admin/constants/admin.constants';

export class AdminCreateRegionInput {
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsString()
  @Length(1, MAX_REGION_NAME_LENGTH)
  name!: string;

  @IsString()
  @Length(1, MAX_REGION_SLUG_LENGTH)
  @Matches(REGION_SLUG_PATTERN)
  slug!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean | null;

  @IsOptional()
  @IsString()
  centerLat?: string | null;

  @IsOptional()
  @IsString()
  centerLng?: string | null;
}
