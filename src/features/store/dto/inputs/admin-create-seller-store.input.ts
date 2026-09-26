import { IsIn, IsOptional, IsString } from 'class-validator';

import {
  STORE_MAP_PROVIDERS,
  type StoreMapProviderValue,
} from '@/features/store/constants/store-map-provider.constants';

/** 온보딩 시 만들 매장 기본 정보. 길이·좌표·지역 검증은 service 에서 수행. */
export class AdminCreateSellerStoreInput {
  @IsString()
  storeName!: string;

  @IsString()
  storePhone!: string;

  @IsString()
  addressFull!: string;

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

  @IsOptional()
  @IsIn(STORE_MAP_PROVIDERS)
  mapProvider?: StoreMapProviderValue;
}
