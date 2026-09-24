import type { ConfigService } from '@nestjs/config';

import type { RabbitHealthIndicator } from '@/features/outbox';
import type { HealthRepository } from '@/features/system/repositories/health.repository';
import { HealthService } from '@/features/system/services/health.service';
import type { RedisHealthIndicator } from '@/global/pubsub';

function indicator(name: string, ok: boolean) {
  return {
    name,
    check: ok
      ? () => Promise.resolve()
      : () => Promise.reject(new Error(`${name} down`)),
  };
}

describe('HealthService', () => {
  function build(
    mysqlUp: boolean,
    redisUp: boolean,
    role: 'api' | 'worker' = 'api',
    rabbitUp = true,
  ): HealthService {
    return new HealthService(
      { getOrThrow: () => ({ role }) } as unknown as ConfigService,
      indicator('mysql', mysqlUp) as unknown as HealthRepository,
      indicator('redis', redisUp) as unknown as RedisHealthIndicator,
      indicator('rabbitmq', rabbitUp) as unknown as RabbitHealthIndicator,
    );
  }

  it('전부 응답하면 ok', async () => {
    await expect(build(true, true).ready()).resolves.toEqual({
      ok: true,
      checks: { mysql: 'up', redis: 'up' },
    });
  });

  // 반증 전수 — 어느 한쪽만 죽어도 ok가 아니고, 어느 쪽이 죽었는지 checks에 남는다.
  it.each([
    [false, true, { mysql: 'down', redis: 'up' }],
    [true, false, { mysql: 'up', redis: 'down' }],
    [false, false, { mysql: 'down', redis: 'down' }],
  ])('mysql=%s redis=%s → not ready', async (mysqlUp, redisUp, checks) => {
    await expect(build(mysqlUp, redisUp).ready()).resolves.toEqual({
      ok: false,
      checks,
    });
  });

  // 브로커는 worker만 쓴다 — api의 ready는 브로커를 보지 않고, worker는 본다
  it('api 역할은 rabbitmq를 보지 않는다', async () => {
    await expect(build(true, true, 'api', false).ready()).resolves.toEqual({
      ok: true,
      checks: { mysql: 'up', redis: 'up' },
    });
  });

  it('worker 역할은 rabbitmq까지 본다', async () => {
    await expect(build(true, true, 'worker', false).ready()).resolves.toEqual({
      ok: false,
      checks: { mysql: 'up', redis: 'up', rabbitmq: 'down' },
    });
  });
});
