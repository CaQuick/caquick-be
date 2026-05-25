import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Seller 도메인 cursor 기반 페이지네이션 공통 입력.
 *
 * SDL 기본값: limit=20. limit 최대 100 (운영 보호).
 */
export class SellerCursorInput {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
