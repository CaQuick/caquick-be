/** 의존성 하나의 준비 상태. check()는 정상이면 resolve, 아니면 throw — 판정과 응답 형태는 HealthService가 맡는다. */
export interface HealthIndicator {
  readonly name: string;
  check(): Promise<void>;
}

/** ready 판정은 짧게 끝나야 한다 — 의존성이 매달리면 compose가 그걸 "죽음"으로 보고 재기동한다. */
export const HEALTH_CHECK_TIMEOUT_MS = 2_000;
