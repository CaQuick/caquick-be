import { IsArray, IsString } from 'class-validator';

export class SellerSetProductCategoriesInput {
  @IsString()
  productId!: string;

  @IsArray()
  @IsString({ each: true })
  categoryIds!: string[];
}
