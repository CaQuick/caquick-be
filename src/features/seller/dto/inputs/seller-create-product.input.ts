import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

/** salePrice <= regularPrice 같은 도메인 invariant와 currency 정규화는 service가 담당. */
export class SellerCreateProductInput {
  @IsString()
  name!: string;

  @IsString()
  initialImageUrl!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  purchaseNotice?: string;

  @IsInt()
  @Min(0)
  regularPrice!: number;

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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
