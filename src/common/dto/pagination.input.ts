import { IsInt, Max, Min } from 'class-validator';

/**
 * offset 기반 페이지네이션 공통 입력.
 *
 * 왜: user/seller 도메인의 offset/limit 수동 검증이 여러 곳에 산재되어 있어
 * 단일 진실 소스로 통합. 한도 100은 운영 보호 목적의 상한.
 */
export class PaginationInput {
  @IsInt()
  @Min(0)
  offset!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  limit!: number;
}
