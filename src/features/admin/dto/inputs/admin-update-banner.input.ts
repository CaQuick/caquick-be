import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

import {
  BANNER_LINK_TYPES,
  BANNER_PLACEMENTS,
  type BannerLinkTypeValue,
  type BannerPlacementValue,
} from '@/features/admin/constants/admin.constants';

/**
 * 부분 수정 입력. GraphQL은 nullable 필드에 null을 허용하는데 @IsOptional은 null도 건너뛴다.
 * 컬럼이 non-null인 속성(placement·imageUrl·linkType·sortOrder·isActive)은 "미지정"만
 * 허용하고 명시적 null은 거절한다 — 서비스에서 trim()/Prisma non-null 위반으로 500이 나지 않게.
 * 지울 수 있는 속성(title·링크 값·기간)은 null이 의도된 값이라 @IsOptional을 유지한다.
 */
const ifPresent = (field: keyof AdminUpdateBannerInput) =>
  ValidateIf((o: AdminUpdateBannerInput) => o[field] !== undefined);

export class AdminUpdateBannerInput {
  @IsString()
  bannerId!: string;

  @ifPresent('placement')
  @IsIn(BANNER_PLACEMENTS)
  placement?: BannerPlacementValue;

  @IsOptional()
  @IsString()
  title?: string;

  @ifPresent('imageUrl')
  @IsString()
  imageUrl?: string;

  @ifPresent('linkType')
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

  @ifPresent('sortOrder')
  @IsInt()
  sortOrder?: number;

  @ifPresent('isActive')
  @IsBoolean()
  isActive?: boolean;
}
