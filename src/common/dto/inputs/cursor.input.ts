import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const CURSOR_PAGE_DEFAULT_LIMIT = 20;
export const CURSOR_PAGE_MAX_LIMIT = 100;

/** 커서 페이지네이션 공통 입력(SDL `CursorInput`). 필터가 있는 목록 입력은 이 클래스를 extends 한다. */
export class CursorInput {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CURSOR_PAGE_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
