/** 키셋 커서 목록 응답. SDL `*Connection`(커서형)과 1:1 — 커서는 불투명 토큰이라 정렬 기준이 바뀌면 무효다. */
export interface CursorConnection<T> {
  items: T[];
  nextCursor: string | null;
  /** limit+1 조회 결과로 판정하므로 추가 쿼리가 없다. */
  hasMore: boolean;
  totalCount: number;
}

/** offset 목록 응답. SDL `*Connection`(offset형)과 1:1. */
export interface OffsetConnection<T> {
  items: T[];
  totalCount: number;
  hasMore: boolean;
}
