import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** limit 최대 50(운영 보호) — common의 상한 100과 도메인별 정책 차이로 분리한다. */
export class UserPaginationInput {
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
