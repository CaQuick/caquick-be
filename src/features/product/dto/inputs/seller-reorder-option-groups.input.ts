import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class SellerReorderOptionGroupsInput {
  @IsString()
  productId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  optionGroupIds!: string[];
}
