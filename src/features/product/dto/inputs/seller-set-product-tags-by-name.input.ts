import { IsArray, IsString } from 'class-validator';

export class SellerSetProductTagsByNameInput {
  @IsString()
  productId!: string;

  @IsArray()
  @IsString({ each: true })
  names!: string[];
}
