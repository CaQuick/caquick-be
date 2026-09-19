import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class SellerCreateOptionItemInput {
  @IsString()
  optionGroupId!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  priceDelta?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
