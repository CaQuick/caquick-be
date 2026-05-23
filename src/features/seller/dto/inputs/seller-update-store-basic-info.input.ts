import { IsIn, IsOptional, IsString } from 'class-validator';

const MAP_PROVIDERS = ['NAVER', 'KAKAO', 'NONE'] as const;
type SellerStoreMapProvider = (typeof MAP_PROVIDERS)[number];

export class SellerUpdateStoreBasicInfoInput {
  @IsOptional()
  @IsString()
  storeName?: string;

  @IsOptional()
  @IsString()
  storePhone?: string;

  @IsOptional()
  @IsString()
  addressFull?: string;

  @IsOptional()
  @IsString()
  addressCity?: string;

  @IsOptional()
  @IsString()
  addressDistrict?: string;

  @IsOptional()
  @IsString()
  addressNeighborhood?: string;

  @IsOptional()
  @IsString()
  latitude?: string;

  @IsOptional()
  @IsString()
  longitude?: string;

  @IsOptional()
  @IsIn(MAP_PROVIDERS)
  mapProvider?: SellerStoreMapProvider;

  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  businessHoursText?: string;
}
