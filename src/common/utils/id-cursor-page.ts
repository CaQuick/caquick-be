/**
 * id 내림차순 키셋 커서 목록의 입력 정규화·페이지 절단.
 * 판매자·관리자 목록 API가 공유한다(DI-free 순수 함수).
 */

/** limit은 1~100으로 clamp(운영 보호), cursor는 있을 때만 싣는다. */
export function normalizeCursorInput(input?: {
  limit?: number | null;
  cursor?: bigint | null;
}): { limit: number; cursor?: bigint } {
  const safeLimit = Math.min(Math.max(input?.limit ?? 20, 1), 100);
  const cursor = input?.cursor ?? undefined;
  return {
    limit: safeLimit,
    ...(cursor ? { cursor } : {}),
  };
}

/**
 * limit+1개를 조회한 결과에서 페이지와 다음 커서를 뽑는다.
 *
 * hasMore는 추가 쿼리 없이 나온다 — limit보다 많이 왔으면 다음 페이지가 있다는 뜻이다.
 */
export function nextCursorOf<T extends { id: bigint }>(
  rows: T[],
  limit: number,
): {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
} {
  if (rows.length <= limit) {
    return {
      items: rows,
      nextCursor: null,
      hasMore: false,
    };
  }

  const sliced = rows.slice(0, limit);
  return {
    items: sliced,
    hasMore: true,
    nextCursor: sliced[sliced.length - 1]?.id.toString() ?? null,
  };
}
