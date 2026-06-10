import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SellerUpsertProductCustomTemplateInput {
  @IsString()
  productId!: string;

  @IsString()
  baseImageUrl!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
