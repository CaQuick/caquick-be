import type { ModuleMetadata, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';

import { ClockService } from '@/common/providers/clock.service';
import { IdGenerator } from '@/common/providers/id-generator.service';
import type { OutboxConfig } from '@/config/outbox.config';
import type { DispatchSummary } from '@/features/outbox';
import { OutboxRepository } from '@/features/outbox/repositories/outbox.repository';
import { OutboxDispatcherService } from '@/features/outbox/services/outbox-dispatcher.service';
import { OutboxPublisher } from '@/features/outbox/services/outbox-publisher.service';
import { AlertService } from '@/global/alerting';

export const OUTBOX_TEST_CONFIG: OutboxConfig = {
  dispatchEnabled: false,
  pollIntervalMs: 1_000,
  batchSize: 100,
  maxAttempts: 5,
  partitionConcurrency: 4,
};

/** spec 모듈에 발행·소비 배선을 붙인다. 소비자는 spec이 providers에 직접 넣는다(@SubscribeOutbox로 발견). */
export const OUTBOX_TEST_IMPORTS: NonNullable<ModuleMetadata['imports']> = [
  DiscoveryModule,
];

/** 발행만 필요한 spec(OrderRepository 등 발행 repository를 주입하는 곳)용 — 디스패처·DiscoveryModule 없이. */
export function outboxPublisherProviders(
  omit: { clock?: boolean; ids?: boolean } = {},
): Provider[] {
  return [
    OutboxRepository,
    OutboxPublisher,
    ...(omit.clock ? [] : [ClockService]),
    ...(omit.ids ? [] : [IdGenerator]),
  ];
}

/** 디스패처가 FAILED에 경보를 쏘므로 spec에는 아무 데도 안 보내는 대역을 넣는다. 경보 자체는 alert.service.spec이 본다. */
export const NOOP_ALERT_PROVIDER: Provider = {
  provide: AlertService,
  useValue: { notify: () => Promise.resolve('skipped' as const) },
};

/** ClockService·IdGenerator·ConfigService를 spec이 따로 넣으면 그쪽을 빼고(중복 provider 방지) 실제 구현 대신 그 값을 쓴다. */
export function outboxTestProviders(
  omit: {
    clock?: boolean;
    ids?: boolean;
    config?: boolean;
    alerts?: boolean;
  } = {},
): Provider[] {
  return [
    OutboxRepository,
    OutboxPublisher,
    OutboxDispatcherService,
    ...(omit.alerts ? [] : [NOOP_ALERT_PROVIDER]),
    ...(omit.clock ? [] : [ClockService]),
    ...(omit.ids ? [] : [IdGenerator]),
    ...(omit.config
      ? []
      : [
          {
            provide: ConfigService,
            useValue: { getOrThrow: () => OUTBOX_TEST_CONFIG },
          },
        ]),
  ];
}

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
