import { IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';

import {
  STORE_MAP_PROVIDERS,
  type StoreMapProviderValue,
} from '@/features/admin/constants/admin.constants';

/**
 * 부분 수정 입력. non-null 컬럼(storeName·storePhone·addressFull·mapProvider)은 명시적 null을
 * 거절하고(생략만 가능), 나머지는 null이 "제거" 의도라 @IsOptional을 유지한다.
 */
const ifPresent = (field: keyof AdminUpdateStoreBasicInfoInput) =>
  ValidateIf((o: AdminUpdateStoreBasicInfoInput) => o[field] !== undefined);

export class AdminUpdateStoreBasicInfoInput {
  @IsString()
  storeId!: string;

  @ifPresent('storeName')
  @IsString()
  storeName?: string;

  @ifPresent('storePhone')
  @IsString()
  storePhone?: string;

  @ifPresent('addressFull')
  @IsString()
  addressFull?: string;

  @IsOptional()
  @IsString()
  addressCity?: string | null;

  @IsOptional()
  @IsString()
  addressDistrict?: string | null;

  @IsOptional()
  @IsString()
  addressNeighborhood?: string | null;

  @IsOptional()
  @IsString()
  regionId?: string | null;

  @IsOptional()
  @IsString()
  latitude?: string | null;

  @IsOptional()
  @IsString()
  longitude?: string | null;

  @ifPresent('mapProvider')
  @IsIn(STORE_MAP_PROVIDERS)
  mapProvider?: StoreMapProviderValue;

  @IsOptional()
  @IsString()
  websiteUrl?: string | null;

  @IsOptional()
  @IsString()
  businessHoursText?: string | null;

  @IsOptional()
  @IsString()
  profileImageUrl?: string | null;

  @IsOptional()
  @IsString()
  greetingMessage?: string | null;
}
