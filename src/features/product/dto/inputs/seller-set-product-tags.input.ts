import { IsArray, IsString } from 'class-validator';

export class SellerSetProductTagsInput {
  @IsString()
  productId!: string;

  @IsArray()
  @IsString({ each: true })
  tagIds!: string[];
}
