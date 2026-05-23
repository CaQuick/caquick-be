import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SellerUpdateOptionGroupInput {
  @IsString()
  optionGroupId!: string;

  @IsOptional()
  @IsString()
  name?: string;

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
