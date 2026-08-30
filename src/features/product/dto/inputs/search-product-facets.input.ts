import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SearchProductFacetsInput {
  @IsString()
  keyword!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  eventCategoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  styleCategoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  regionIds?: string[];
}
