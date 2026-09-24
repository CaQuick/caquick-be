import type { GraphQLResolveInfo } from 'graphql';

/**
 * 루트 필드별 시작 시각. 인터셉터가 찍고 성공(인터셉터)·실패(예외 필터)가 같은 info로 읽는다 —
 * 요청 시작 시각으로 재면 루트 필드가 여럿인 오퍼레이션에서 뒤 필드가 앞 필드 시간까지 떠안는다.
 */
const startedAt = new WeakMap<GraphQLResolveInfo, number>();

export function markFieldStart(info: GraphQLResolveInfo): void {
  startedAt.set(info, performance.now());
}

/** 시작 기록이 없으면(인터셉터 앞 가드에서 거절) 0 — 처리 시간이 아니라 거절 횟수가 의미다. */
export function fieldDurationSeconds(info: GraphQLResolveInfo): number {
  const started = startedAt.get(info);
  return started === undefined ? 0 : (performance.now() - started) / 1000;
}
