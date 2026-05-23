import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

const BANNER_PLACEMENTS = [
  'HOME_MAIN',
  'HOME_SUB',
  'CATEGORY',
  'STORE',
] as const;
type SellerBannerPlacement = (typeof BANNER_PLACEMENTS)[number];

const BANNER_LINK_TYPES = [
  'NONE',
  'URL',
  'PRODUCT',
  'STORE',
  'CATEGORY',
] as const;
type SellerBannerLinkType = (typeof BANNER_LINK_TYPES)[number];

/**
 * 배너 생성 입력.
 *
 * linkType 별로 linkUrl / linkProductId / linkStoreId / linkCategoryId
 * 중 어느 것을 사용할지의 조합 검증은 도메인 invariant 로 service 에서 수행.
 */
export class SellerCreateBannerInput {
  @IsIn(BANNER_PLACEMENTS)
  placement!: SellerBannerPlacement;

  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  imageUrl!: string;

  @IsOptional()
  @IsIn(BANNER_LINK_TYPES)
  linkType?: SellerBannerLinkType;

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
