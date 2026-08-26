import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class MyWishlistedStoresInput {
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
