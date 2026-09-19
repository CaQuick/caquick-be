import type {
  DispatchSummary,
  OutboxDispatcherService,
} from '@/features/outbox';

/**
 * 폴링 없이 outbox를 소진한다 — spec이 이벤트 소비 결과를 동기로 단언하기 위한 헬퍼.
 * 진행(published·retried·failed)이 없는 틱에서 멈추므로 백오프 대기 중인 이벤트는 남는다(시계를 앞당겨 다시 부른다).
 */
export async function drainOutbox(
  dispatcher: OutboxDispatcherService,
  maxRounds = 10,
): Promise<DispatchSummary> {
  const total: DispatchSummary = {
    published: 0,
    retried: 0,
    failed: 0,
    deferred: 0,
  };
  for (let round = 0; round < maxRounds; round++) {
    const tick = await dispatcher.dispatchOnce();
    total.published += tick.published;
    total.retried += tick.retried;
    total.failed += tick.failed;
    total.deferred += tick.deferred;
    if (tick.published + tick.retried + tick.failed === 0) return total;
  }
  throw new Error(
    `outbox가 ${maxRounds}라운드 안에 비지 않았다: ${JSON.stringify(total)}`,
  );
}
