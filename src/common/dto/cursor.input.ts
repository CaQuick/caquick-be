import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * cursor 기반 페이지네이션 공통 입력.
 *
 * 왜: seller 도메인 다수 목록 조회에서 cursor + limit 패턴 반복. limit 상한은
 * 100으로 통일하여 운영 보호.
 */
export class CursorInput {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  limit!: number;
}
