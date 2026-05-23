import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class SellerReorderProductImagesInput {
  @IsString()
  productId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  imageIds!: string[];
}
