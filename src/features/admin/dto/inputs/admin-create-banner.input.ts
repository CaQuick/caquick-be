import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

import {
  BANNER_LINK_TYPES,
  BANNER_PLACEMENTS,
  type BannerLinkTypeValue,
  type BannerPlacementValue,
} from '@/features/admin/constants/admin.constants';

/** linkType별 링크 필드 조합은 도메인 invariant라 service에서 검증한다. */
export class AdminCreateBannerInput {
  @IsIn(BANNER_PLACEMENTS)
  placement!: BannerPlacementValue;

  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  imageUrl!: string;

  @IsOptional()
  @IsIn(BANNER_LINK_TYPES)
  linkType?: BannerLinkTypeValue;

  @IsOptional()
  @IsString()
  linkUrl?: string;

  @IsOptional()
  @IsString()
  linkProductId?: string | null;

  @IsOptional()
  @IsString()
  linkStoreId?: string | null;

  @IsOptional()
  @IsString()
  linkCategoryId?: string | null;

  @IsOptional()
  @IsDate()
  startsAt?: Date;

  @IsOptional()
  @IsDate()
  endsAt?: Date;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
