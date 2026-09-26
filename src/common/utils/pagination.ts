import type { CursorConnection } from '@/common/types/cursor-connection.type';

/** 커서 토큰의 형식/파싱은 정렬 정책과 결합돼 있어 호출부 책임으로 남긴다. */

export interface CursorPage<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

/** 음수 limit은 0으로 정규화한다 — slice(0, -1)이 마지막 항목을 떨어뜨리는 형태로 조용히 동작하지 않게(범용 유틸이라 DTO 검증과 별개로 방어). */
export function sliceOverfetched<T>(
  rows: T[],
  limit: number,
): { items: T[]; hasMore: boolean } {
  const safeLimit = Math.max(0, limit);
  const hasMore = rows.length > safeLimit;
  return { items: hasMore ? rows.slice(0, safeLimit) : rows, hasMore };
}

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

export function hasMoreByOffset(
  offset: number,
  limit: number,
  totalCount: number,
): boolean {
  return offset + Math.max(0, limit) < totalCount;
}

/** limit 1~100 clamp는 운영 보호(호출부 DTO와 별개). */
export function normalizeCursorInput(input?: {
  limit?: number | null;
  cursor?: bigint | null;
}): { limit: number; cursor?: bigint } {
  const safeLimit = Math.min(Math.max(input?.limit ?? 20, 1), 100);
  const cursor = input?.cursor ?? undefined;
  return {
    limit: safeLimit,
    ...(cursor !== undefined ? { cursor } : {}),
  };
}

export function sliceIdCursorPage<T extends { id: bigint }>(
  rows: T[],
  limit: number,
): CursorPage<T> {
  return sliceCursorPage(rows, limit, (last) => last.id.toString());
}

export function toCursorConnection<T, U>(
  page: CursorPage<T>,
  totalCount: number,
  map: (item: T) => U,
): CursorConnection<U> {
  return {
    items: page.items.map(map),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    totalCount,
  };
}
