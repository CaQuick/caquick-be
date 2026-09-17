import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const CURSOR_PAGE_DEFAULT_LIMIT = 20;
export const CURSOR_PAGE_MAX_LIMIT = 100;

/** 커서 페이지네이션 공통 입력(SDL `CursorInput`). 필터가 있는 목록 입력은 이 클래스를 extends 한다. */
export class CursorInput {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CURSOR_PAGE_MAX_LIMIT)
  limit?: number;

  // 빈 문자열은 커서 생략이 아니라 형식 오류다 — 호출부의 truthy 검사가 첫 페이지로 조용히 넘기지 않게 DTO에서 거절한다
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cursor?: string;
}
