import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SearchSummaryInput {
  @IsString()
  keyword!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  regionIds?: string[];
}
