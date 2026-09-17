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

import {
  REVIEW_SORTS,
  type ReviewSort,
} from '@/features/review/constants/review.constants';

export class ProductReviewsInput {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsOptional()
  @IsBoolean()
  photoOnly?: boolean;

  @IsOptional()
  @IsIn(REVIEW_SORTS)
  sort?: ReviewSort;

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
