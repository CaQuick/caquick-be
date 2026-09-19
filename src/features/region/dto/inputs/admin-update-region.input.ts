import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

import {
  MAX_REGION_NAME_LENGTH,
  MAX_REGION_SLUG_LENGTH,
  REGION_SLUG_PATTERN,
} from '@/features/region/constants/region.constants';

/** non-null 컬럼(name·slug·sortOrder·isActive)은 명시적 null 거절, 좌표는 null이 "제거". */
const ifPresent = (field: keyof AdminUpdateRegionInput) =>
  ValidateIf((o: AdminUpdateRegionInput) => o[field] !== undefined);

export class AdminUpdateRegionInput {
  @IsString()
  regionId!: string;

  @ifPresent('name')
  @IsString()
  @Length(1, MAX_REGION_NAME_LENGTH)
  name?: string;

  @ifPresent('slug')
  @IsString()
  @Length(1, MAX_REGION_SLUG_LENGTH)
  @Matches(REGION_SLUG_PATTERN)
  slug?: string;

  @ifPresent('sortOrder')
  @IsInt()
  sortOrder?: number;

  @ifPresent('isActive')
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  centerLat?: string | null;

  @IsOptional()
  @IsString()
  centerLng?: string | null;
}
