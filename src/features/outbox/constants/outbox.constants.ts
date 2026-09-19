/** `@SubscribeOutbox()`가 provider 클래스에 남기는 메타데이터 키 — 디스패처가 DiscoveryService로 찾는다. */
export const OUTBOX_CONSUMER_EVENTS = 'outbox:consumer-events';

/** 재시도 백오프 1s·2s·4s… 상한 5분 — 소비자 장애가 길어져도 폴링 부하가 늘지 않게. */
export const OUTBOX_RETRY_BASE_MS = 1_000;
export const OUTBOX_RETRY_MAX_MS = 5 * 60_000;

export function retryBackoffMs(attempts: number): number {
  return Math.min(
    OUTBOX_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1),
    OUTBOX_RETRY_MAX_MS,
  );
}
