import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * 옵션 그룹 생성 입력.
 *
 * minSelect <= maxSelect 관계 검증은 service 의 도메인 invariant 로 처리.
 */
export class SellerCreateOptionGroupInput {
  @IsString()
  productId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSelect?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxSelect?: number;

  @IsOptional()
  @IsBoolean()
  optionRequiresDescription?: boolean;

  @IsOptional()
  @IsBoolean()
  optionRequiresImage?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
