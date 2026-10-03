import { type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type Redis from 'ioredis';

import { ClockService } from '@/common/providers/clock.service';
import { RateLimit } from '@/global/rate-limit/rate-limit.decorator';
import {
  RATE_LIMIT_METADATA_KEY,
  RateLimitGuard,
} from '@/global/rate-limit/rate-limit.guard';
import { connectTestRedis } from '@/test/db/redis-test-client';

const LIMIT = 3;
const WINDOW_SECONDS = 60;
const T0 = new Date('2026-10-03T12:00:00.000Z'); // 60초 창의 시작

class Target {
  @RateLimit({ name: 'loc', limit: LIMIT, windowSeconds: WINDOW_SECONDS })
  limited(): void {}

  @RateLimit({ name: 'other', limit: LIMIT, windowSeconds: WINDOW_SECONDS })
  otherLimited(): void {}

  open(): void {}
}

function gqlContext(handler: object, ip: string): ExecutionContext {
  const gqlArgs = [undefined, {}, { req: { ip, headers: {} } }, {}];
  return {
    getType: () => 'graphql',
    getArgs: () => gqlArgs,
    getArgByIndex: (i: number) => gqlArgs[i],
    getHandler: () => handler,
    getClass: () => Target,
  } as unknown as ExecutionContext;
}

function httpContext(handler: object, ip: string): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ ip, headers: {} }) }),
    getHandler: () => handler,
    getClass: () => Target,
  } as unknown as ExecutionContext;
}

class FixedClock extends ClockService {
  constructor(public at: Date) {
    super();
  }
  override now(): Date {
    return this.at;
  }
}

describe('RateLimitGuard (real Redis)', () => {
  let redis: Redis;
  let clock: FixedClock;
  let guard: RateLimitGuard;
  const proto = Target.prototype;

  beforeAll(async () => {
    redis = await connectTestRedis();
  });
  afterAll(async () => {
    await redis.quit();
  });
  beforeEach(async () => {
    await redis.flushdb();
    clock = new FixedClock(T0);
    guard = new RateLimitGuard(new Reflector(), redis, clock);
  });

  async function callTimes(
    ctx: ExecutionContext,
    times: number,
  ): Promise<void> {
    for (let i = 0; i < times; i++) await guard.canActivate(ctx);
  }

  it('@RateLimit은 정책과 가드를 함께 건다', () => {
    expect(Reflect.getMetadata(RATE_LIMIT_METADATA_KEY, proto.limited)).toEqual(
      { name: 'loc', limit: LIMIT, windowSeconds: WINDOW_SECONDS },
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.limited)).toEqual([
      RateLimitGuard,
    ]);
  });

  it('한도까지는 통과하고 넘으면 RATE_LIMITED', async () => {
    const ctx = gqlContext(proto.limited, '203.0.113.1');

    await callTimes(ctx, LIMIT);

    await expect(guard.canActivate(ctx)).rejects.toThrowDomain('RATE_LIMITED');
  });

  it('IP마다 따로 센다', async () => {
    await callTimes(gqlContext(proto.limited, '203.0.113.1'), LIMIT);

    await expect(
      guard.canActivate(gqlContext(proto.limited, '203.0.113.2')),
    ).resolves.toBe(true);
  });

  it('정책 이름마다 따로 센다', async () => {
    await callTimes(gqlContext(proto.limited, '203.0.113.1'), LIMIT);

    await expect(
      guard.canActivate(gqlContext(proto.otherLimited, '203.0.113.1')),
    ).resolves.toBe(true);
  });

  it.each([
    ['창의 마지막 초는 같은 창', WINDOW_SECONDS * 1000 - 1, false],
    ['다음 창이 시작되면 다시 센다', WINDOW_SECONDS * 1000, true],
  ])('%s', async (_label, offsetMs, allowed) => {
    const ctx = gqlContext(proto.limited, '203.0.113.1');
    await callTimes(ctx, LIMIT);

    clock.at = new Date(T0.getTime() + offsetMs);

    if (allowed) await expect(guard.canActivate(ctx)).resolves.toBe(true);
    else
      await expect(guard.canActivate(ctx)).rejects.toThrowDomain(
        'RATE_LIMITED',
      );
  });

  it('창 키에 TTL을 걸어 정리되게 한다', async () => {
    await guard.canActivate(gqlContext(proto.limited, '203.0.113.1'));

    const [key] = await redis.keys('rl:loc:*');
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WINDOW_SECONDS);
  });

  it('HTTP 컨텍스트도 같은 규칙으로 센다', async () => {
    const ctx = httpContext(proto.limited, '203.0.113.1');
    await callTimes(ctx, LIMIT);

    await expect(guard.canActivate(ctx)).rejects.toThrowDomain('RATE_LIMITED');
  });

  it('정책이 없는 핸들러는 세지 않고 통과한다', async () => {
    await callTimes(gqlContext(proto.open, '203.0.113.1'), LIMIT + 1);

    expect(await redis.keys('rl:*')).toEqual([]);
  });

  it('Redis 장애면 통과시킨다', async () => {
    const broken = new Proxy(redis, {
      get(target, prop, receiver) {
        if (prop === 'eval') return () => Promise.reject(new Error('down'));
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    const failOpen = new RateLimitGuard(new Reflector(), broken, clock);
    const ctx = gqlContext(proto.limited, '203.0.113.1');

    for (let i = 0; i < LIMIT + 2; i++) {
      await expect(failOpen.canActivate(ctx)).resolves.toBe(true);
    }
  });
});
