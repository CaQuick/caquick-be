import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { MAX_SEARCH_PAGE_LIMIT } from '@/features/store/constants/store-search.constants';
import {
  STORE_SORTS,
  type StoreSort,
} from '@/features/store/constants/store-sort.constants';

export class PickupStoresInput {
  @IsString()
  date!: string;

  @IsOptional()
  @IsString()
  time?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  regionIds?: string[];

  @IsOptional()
  @IsIn(STORE_SORTS)
  sort?: StoreSort | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SEARCH_PAGE_LIMIT)
  limit?: number;
}
