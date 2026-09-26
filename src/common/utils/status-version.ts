/**
 * 계정 상태 변경 시각은 계정마다 단조 증가해야 한다 — 블랙리스트가 이 값을 버전으로 비교한다.
 * 벽시계만 쓰면 같은 ms의 연속 변경(복구 직후 재정지)이나 복제본 시계 편차에서 뒤 변경이 같거나 작은 버전을
 * 받아 조용히 무시된다. DB에 적힌 이전 값보다 최소 1ms 크게 만든다.
 */
export function nextStatusChangedAt(
  now: Date,
  previous: Date | null | undefined,
): Date {
  const floor = (previous?.getTime() ?? 0) + 1;
  return new Date(Math.max(now.getTime(), floor));
}
