import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { MAX_SEARCH_PAGE_LIMIT } from '@/features/store/constants/store-search.constants';

export class SearchStoresInput {
  @IsString()
  keyword!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  regionIds?: string[];

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
