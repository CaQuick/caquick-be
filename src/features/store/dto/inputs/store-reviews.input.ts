import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class StoreReviewsInput {
  @IsString()
  storeId!: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
