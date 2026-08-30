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

import {
  MAX_SEARCH_PAGE_LIMIT,
  PRODUCT_SEARCH_SORTS,
  type ProductSearchSort,
} from '@/features/product/constants/product-search.constants';

export class SearchProductsInput {
  @IsString()
  keyword!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  eventCategoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  styleCategoryIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  regionIds?: string[];

  @IsOptional()
  @IsIn(PRODUCT_SEARCH_SORTS)
  sort?: ProductSearchSort;

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
