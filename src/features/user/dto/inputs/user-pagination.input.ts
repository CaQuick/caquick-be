import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * 유저 도메인 페이지네이션 공통 입력.
 *
 * SDL 기본값: offset=0, limit=20. limit 최대 50 (운영 보호).
 * common 의 PaginationInput 은 limit 최대 100 이라 도메인별 정책 차이로
 * 분리한다.
 */
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
