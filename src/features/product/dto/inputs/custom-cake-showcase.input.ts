import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CustomCakeShowcaseInput {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
