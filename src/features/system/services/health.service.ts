import { Injectable } from '@nestjs/common';

import type { HealthIndicator } from '@/common/ports/health-indicator.port';
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

  constructor(mysql: HealthRepository, redis: RedisHealthIndicator) {
    this.indicators = [mysql, redis];
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
