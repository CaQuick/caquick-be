import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

/** minSelect <= maxSelect 관계 검증은 service의 도메인 invariant. */
export class SellerCreateOptionGroupInput {
  @IsString()
  productId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

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
