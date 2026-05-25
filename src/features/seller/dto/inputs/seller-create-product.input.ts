import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * 상품 생성 입력.
 *
 * - salePrice <= regularPrice 같은 도메인 invariant 는 service 에서 검증
 * - currency 의 3자 대문자 정규화도 service 의 cleanCurrency 가 담당
 */
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
