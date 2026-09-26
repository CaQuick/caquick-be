import { IsDate, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AdminSearchKeywordSnapshotInput {
  @IsOptional()
  @IsDate()
  rankedAt?: Date | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
