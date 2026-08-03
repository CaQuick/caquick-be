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

export const PRODUCT_REVIEW_SORTS = ['LATEST', 'LIKES'] as const;
export type ProductReviewSort = (typeof PRODUCT_REVIEW_SORTS)[number];

export class ProductReviewsInput {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsOptional()
  @IsBoolean()
  photoOnly?: boolean;

  @IsOptional()
  @IsIn(PRODUCT_REVIEW_SORTS)
  sort?: ProductReviewSort;

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
