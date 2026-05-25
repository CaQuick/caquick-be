import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SellerUpdateProductInput {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  purchaseNotice?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  regularPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salePrice?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  baseDesignImageUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  preparationTimeMinutes?: number;
}
