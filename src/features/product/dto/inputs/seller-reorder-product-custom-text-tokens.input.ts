import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class SellerReorderProductCustomTextTokensInput {
  @IsString()
  templateId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  tokenIds!: string[];
}
