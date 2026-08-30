/**
 * 페이지네이션 조립 공용 유틸(이슈 #226).
 * - 커서형: `take: limit + 1` 초과 조회 → 페이지 절단 → 다음 커서 계산
 * - offset형: 잔여 여부 계산
 * 커서 토큰의 형식/파싱은 정렬 정책과 결합돼 있어 호출부 책임으로 남긴다.
 */

/** 키셋 커서 페이지네이션 결과 조각. */
export interface CursorPage<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * `take: limit + 1` 초과 조회 결과를 페이지와 잔여 여부로 자른다.
 * 음수 limit은 0으로 정규화한다 — slice(0, -1)이 마지막 항목을 떨어뜨리는
 * 형태로 조용히 동작하지 않게 한다(호출부는 DTO 검증을 거치지만 범용 유틸이라
 * 방어를 둔다. 릴리즈 리뷰 반영, PR #237).
 */
export function sliceOverfetched<T>(
  rows: T[],
  limit: number,
): { items: T[]; hasMore: boolean } {
  const safeLimit = Math.max(0, limit);
  const hasMore = rows.length > safeLimit;
  return { items: hasMore ? rows.slice(0, safeLimit) : rows, hasMore };
}

/** 초과 조회 결과 → 커서 페이지. 다음 커서는 페이지 마지막 행에서 계산한다. */
export function sliceCursorPage<T>(
  rows: T[],
  limit: number,
  toCursor: (last: T) => string,
): CursorPage<T> {
  const { items, hasMore } = sliceOverfetched(rows, limit);
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    // limit<=0 방어: 잔여가 있어도 페이지가 비면 커서를 만들 수 없다
    nextCursor: hasMore && last !== undefined ? toCursor(last) : null,
  };
}

/** offset 페이지네이션의 잔여 여부. 음수 limit은 0으로 정규화한다. */
export function hasMoreByOffset(
  offset: number,
  limit: number,
  totalCount: number,
): boolean {
  return offset + Math.max(0, limit) < totalCount;
}
