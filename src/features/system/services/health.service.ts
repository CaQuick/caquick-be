import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { HealthIndicator } from '@/common/ports/health-indicator.port';
import { type AppConfig, runsBackgroundJobs } from '@/config/app.config';
import { RabbitHealthIndicator } from '@/features/outbox';
import { HealthRepository } from '@/features/system/repositories/health.repository';
import { RedisHealthIndicator } from '@/global/pubsub';

export type HealthStatus = 'up' | 'down';

export interface ReadinessResult {
  ok: boolean;
  checks: Record<string, HealthStatus>;
}

/** ready = 의존성 전부 응답. 하나라도 죽으면 전체를 not-ready로 — 반쯤 살아서 요청을 받으면 오류만 늘린다. */
@Injectable()
export class HealthService {
  private readonly indicators: HealthIndicator[];

  constructor(
    config: ConfigService,
    mysql: HealthRepository,
    redis: RedisHealthIndicator,
    rabbit: RabbitHealthIndicator,
  ) {
    // 브로커는 worker만 쓴다(api는 outbox 테이블에만 쓴다) — api의 ready가 브로커 장애로 내려가면 요청까지 잃는다
    const role = config.getOrThrow<AppConfig>('app').role;
    this.indicators = runsBackgroundJobs(role)
      ? [mysql, redis, rabbit]
      : [mysql, redis];
  }

  async ready(): Promise<ReadinessResult> {
    const entries = await Promise.all(
      this.indicators.map(
        async (indicator): Promise<[string, HealthStatus]> => {
          try {
            await indicator.check();
            return [indicator.name, 'up'];
          } catch {
            return [indicator.name, 'down'];
          }
        },
      ),
    );
    return {
      ok: entries.every(([, status]) => status === 'up'),
      checks: Object.fromEntries(entries),
    };
  }
}
