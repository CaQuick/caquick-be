import { registerAs } from '@nestjs/config';

export interface OutboxConfig {
  /** 폴링 디스패처 가동 여부. 테스트·일회성 스크립트는 끄고 drainOutbox()로 소비한다. */
  dispatchEnabled: boolean;
  pollIntervalMs: number;
  /** 한 틱에 읽는 기한 도래 이벤트 수 */
  batchSize: number;
  /** 이 횟수를 채우면 FAILED(DLQ 상태)로 남기고 파티션을 막지 않는다 */
  maxAttempts: number;
  /** 파티션 간 병렬 처리 폭(파티션 안은 항상 순차) */
  partitionConcurrency: number;
}

/** 잘못된 값은 조용히 기본값으로 가지 않는다 — 폴링 주기·재시도 상한은 운영 동작을 바꾸므로 부팅에서 드러낸다. */
function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name}은(는) 양의 정수여야 합니다: ${raw}`);
  }
  return value;
}

export default registerAs('outbox', (): OutboxConfig => ({
  dispatchEnabled:
    process.env.OUTBOX_DISPATCH_ENABLED?.trim().toLowerCase() !== 'false',
  pollIntervalMs: positiveInt('OUTBOX_POLL_INTERVAL_MS', 1_000),
  batchSize: positiveInt('OUTBOX_BATCH_SIZE', 100),
  maxAttempts: positiveInt('OUTBOX_MAX_ATTEMPTS', 5),
  partitionConcurrency: positiveInt('OUTBOX_PARTITION_CONCURRENCY', 4),
}));
