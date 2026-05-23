import { IsInt, IsOptional, IsString } from 'class-validator';

export class SellerAddProductImageInput {
  @IsString()
  productId!: string;

  @IsString()
  imageUrl!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
