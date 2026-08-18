import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class RandomCakesInput {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number;
}
