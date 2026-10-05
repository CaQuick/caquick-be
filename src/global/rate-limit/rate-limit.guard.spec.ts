import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type Redis from 'ioredis';

import { ClockService } from '@/common/providers/clock.service';
import { sha256Hex } from '@/common/utils/crypto';
import { RateLimit } from '@/global/rate-limit/rate-limit.decorator';
import {
  RATE_LIMIT_METADATA_KEY,
  RateLimitGuard,
} from '@/global/rate-limit/rate-limit.guard';
import { connectTestRedis } from '@/test/db/redis-test-client';

const LIMIT = 3;
const WINDOW_SECONDS = 60;
const LOGIN_WINDOW_SECONDS = 900;
const T0 = new Date('2026-10-03T12:00:00.000Z'); // 60초·900초 창의 시작
const LOGIN_WINDOW = Math.floor(T0.getTime() / 1000 / LOGIN_WINDOW_SECONDS);

class Target {
  @RateLimit({ name: 'loc', limit: LIMIT, windowSeconds: WINDOW_SECONDS })
  limited(): void {}

  @RateLimit({ name: 'other', limit: LIMIT, windowSeconds: WINDOW_SECONDS })
  otherLimited(): void {}

  @RateLimit({
    name: 'login',
    subject: 'ip+username',
    limit: LIMIT,
    windowSeconds: LOGIN_WINDOW_SECONDS,
    code: 'LOGIN_RATE_LIMITED',
  })
  byUser(): void {}

  @RateLimit({
    name: 'login-default',
    subject: 'ip+username',
    limit: LIMIT,
    windowSeconds: WINDOW_SECONDS,
  })
  byUserDefaultCode(): void {}

  @RateLimit(
    { name: 'dual-user', subject: 'ip+username', limit: 2, windowSeconds: 60 },
    { name: 'dual-ip', limit: 3, windowSeconds: 60 },
  )
  dual(): void {}

  @SetMetadata(RATE_LIMIT_METADATA_KEY, {
    name: 'single',
    limit: LIMIT,
    windowSeconds: WINDOW_SECONDS,
  })
  singleObject(): void {}

  open(): void {}
}

type Body = Record<string, unknown>;

function gqlContext(
  handler: object,
  ip: string,
  body?: Body,
): ExecutionContext {
  const gqlArgs = [undefined, {}, { req: { ip, headers: {}, body } }, {}];
  return {
    getType: () => 'graphql',
    getArgs: () => gqlArgs,
    getArgByIndex: (i: number) => gqlArgs[i],
    getHandler: () => handler,
    getClass: () => Target,
  } as unknown as ExecutionContext;
}

function httpContext(
  handler: object,
  ip: string,
  body?: Body,
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ ip, headers: {}, body }) }),
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

  it('@RateLimit은 정책(배열)과 가드를 함께 건다', () => {
    expect(Reflect.getMetadata(RATE_LIMIT_METADATA_KEY, proto.limited)).toEqual(
      [{ name: 'loc', limit: LIMIT, windowSeconds: WINDOW_SECONDS }],
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.limited)).toEqual([
      RateLimitGuard,
    ]);
  });

  it('정책이 배열 아닌 객체 하나로 저장돼 있어도 센다', async () => {
    const ctx = httpContext(proto.singleObject, '203.0.113.1');
    await callTimes(ctx, LIMIT);

    await expect(guard.canActivate(ctx)).rejects.toThrowDomain('RATE_LIMITED');
  });

  it('클래스에는 걸 수 없다(가드가 핸들러 정책만 읽어 조용히 빠지지 않게)', () => {
    // @ts-expect-error RateLimit은 메서드 전용 데코레이터다
    @RateLimit({ name: 'cls', limit: 1, windowSeconds: 1 })
    class ClassLevel {}
    expect(ClassLevel).toBeDefined();
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

  describe('subject ip+username', () => {
    const IP = '203.0.113.1';
    const login = (ip: string, username?: unknown) =>
      httpContext(proto.byUser, ip, { username, password: 'x' });

    it('같은 IP라도 username이 다르면 따로 센다', async () => {
      await callTimes(login(IP, 'alice'), LIMIT);

      await expect(guard.canActivate(login(IP, 'bob'))).resolves.toBe(true);
      await expect(guard.canActivate(login(IP, 'alice'))).rejects.toThrowDomain(
        'LOGIN_RATE_LIMITED',
      );
    });

    it('같은 username이라도 IP가 다르면 따로 센다', async () => {
      await callTimes(login(IP, 'alice'), LIMIT);

      await expect(
        guard.canActivate(login('203.0.113.2', 'alice')),
      ).resolves.toBe(true);
    });

    it.each([
      ['대소문자', 'Alice'],
      ['앞뒤 공백', '  alice '],
    ])('username의 %s 차이는 같은 키다', async (_label, variant) => {
      await callTimes(login(IP, variant), LIMIT);

      await expect(guard.canActivate(login(IP, 'alice'))).rejects.toThrowDomain(
        'LOGIN_RATE_LIMITED',
      );
    });

    it.each([
      ['없음', undefined],
      ['문자열 아님', 42],
      ['공백뿐', '   '],
    ])('username이 %s이면 IP 키로 센다', async (_label, username) => {
      await callTimes(login(IP, username), LIMIT);

      await expect(
        guard.canActivate(httpContext(proto.byUser, IP)),
      ).rejects.toThrowDomain('LOGIN_RATE_LIMITED');
      expect(await redis.keys('rl:login:*')).toEqual([
        `rl:login:${IP}:${LOGIN_WINDOW}`,
      ]);
    });

    it('키에는 username 원문 대신 해시 16자가 들어간다', async () => {
      await guard.canActivate(login(IP, 'Alice@Example.com'));

      const keys = await redis.keys('rl:login:*');
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe(
        `rl:login:${IP}:${sha256Hex('alice@example.com').slice(0, 16)}:${LOGIN_WINDOW}`,
      );
      expect(keys[0].toLowerCase()).not.toContain('alice');
    });

    it('GraphQL 컨텍스트에서도 바디 username을 읽는다', async () => {
      const ctx = gqlContext(proto.byUser, IP, { username: 'alice' });
      await callTimes(ctx, LIMIT);

      await expect(
        guard.canActivate(gqlContext(proto.byUser, IP, { username: 'bob' })),
      ).resolves.toBe(true);
      await expect(guard.canActivate(ctx)).rejects.toThrowDomain(
        'LOGIN_RATE_LIMITED',
      );
    });

    it('code 지정 시 그 코드와 창 길이(분)를 넣은 메시지로 던진다', async () => {
      await callTimes(login(IP, 'alice'), LIMIT);

      await expect(guard.canActivate(login(IP, 'alice'))).rejects.toMatchObject(
        {
          code: 'LOGIN_RATE_LIMITED',
          response: { message: expect.stringContaining('15분') as string },
        },
      );
    });

    it('code 미지정이면 RATE_LIMITED다', async () => {
      const ctx = httpContext(proto.byUserDefaultCode, IP, {
        username: 'alice',
      });
      await callTimes(ctx, LIMIT);

      await expect(guard.canActivate(ctx)).rejects.toThrowDomain(
        'RATE_LIMITED',
      );
    });
  });

  describe('정책 2개', () => {
    const IP = '203.0.113.1';
    const dual = (username: string) =>
      httpContext(proto.dual, IP, { username });

    it('username 한도(2)만 넘어도 거절하고 IP 키도 함께 증가한다', async () => {
      await callTimes(dual('alice'), 2);

      await expect(guard.canActivate(dual('alice'))).rejects.toThrowDomain(
        'RATE_LIMITED',
      );
      expect(await redis.get(`rl:dual-ip:${IP}:${T0.getTime() / 60000}`)).toBe(
        '3',
      );
    });

    it('username마다 한도 안이어도 IP 합계(3)가 넘으면 거절한다', async () => {
      await guard.canActivate(dual('a'));
      await guard.canActivate(dual('b'));
      await guard.canActivate(dual('c'));

      await expect(guard.canActivate(dual('d'))).rejects.toThrowDomain(
        'RATE_LIMITED',
      );
    });
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
