import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SearchSummaryInput {
  @IsOptional()
  @IsString()
  keyword?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  regionIds?: string[];
}
