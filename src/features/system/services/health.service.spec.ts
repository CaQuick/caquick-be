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
  function build(mysqlUp: boolean, redisUp: boolean): HealthService {
    return new HealthService(
      indicator('mysql', mysqlUp) as unknown as HealthRepository,
      indicator('redis', redisUp) as unknown as RedisHealthIndicator,
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
});
