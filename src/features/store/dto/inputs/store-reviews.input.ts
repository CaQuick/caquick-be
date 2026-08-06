import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const STORE_REVIEW_SORTS = ['LATEST', 'LIKES'] as const;
export type StoreReviewSort = (typeof STORE_REVIEW_SORTS)[number];

export class StoreReviewsInput {
  @IsString()
  @IsNotEmpty()
  storeId!: string;

  @IsOptional()
  @IsBoolean()
  photoOnly?: boolean;

  @IsOptional()
  @IsIn(STORE_REVIEW_SORTS)
  sort?: StoreReviewSort;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
