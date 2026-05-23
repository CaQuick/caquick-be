import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SellerUpsertProductCustomTextTokenInput {
  @IsOptional()
  @IsString()
  tokenId?: string;

  @IsString()
  templateId!: string;

  @IsString()
  tokenKey!: string;

  @IsString()
  defaultText!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxLength?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  posX?: number;

  @IsOptional()
  @IsInt()
  posY?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;
}
