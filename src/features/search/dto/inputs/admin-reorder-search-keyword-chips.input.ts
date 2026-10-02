import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class AdminReorderSearchKeywordChipsInput {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  chipIds!: string[];
}
