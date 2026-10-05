import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { MAX_TAG_SUGGESTIONS } from '@/features/product/constants/product-seller.constants';

export class SellerTagSearchInput {
  @IsString()
  keyword!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_TAG_SUGGESTIONS)
  limit?: number | null;
}
