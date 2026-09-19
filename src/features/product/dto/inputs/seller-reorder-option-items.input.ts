import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class SellerReorderOptionItemsInput {
  @IsString()
  optionGroupId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  optionItemIds!: string[];
}
