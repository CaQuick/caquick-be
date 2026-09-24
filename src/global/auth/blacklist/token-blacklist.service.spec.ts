import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';

import { ClockService } from '@/common/providers/clock.service';
import { AlertService } from '@/global/alerting';
import {
  BLACKLIST_READY_KEY,
  BLACKLIST_READY_TTL_SECONDS,
  credentialCutoffSec,
  STATUS_SCAN_PAGE,
  TokenBlacklistService,
} from '@/global/auth/blacklist/token-blacklist.service';
import { TEST_AUTH_CONFIG } from '@/test/auth-config';
import { connectTestRedis } from '@/test/db/redis-test-client';
import { redisTestProviders } from '@/test/redis';

const T1 = new Date('2026-09-25T12:00:00.500Z');
const T2 = new Date(T1.getTime() + 30_000);
const T3 = new Date(T2.getTime() + 30_000);
const TTL = TEST_AUTH_CONFIG.jwtAccessExpiresSeconds;
const down = () => Promise.reject(new Error('down'));
const config = {
  getOrThrow: () => TEST_AUTH_CONFIG,
} as unknown as ConfigService;

describe('TokenBlacklistService (real Redis)', () => {
  let service: TokenBlacklistService;
  let redis: Redis;
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };

  /** 실제 클라이언트 위에 일부 명령만 바꿔 끼운다 — 나머지(status·mget·del…)는 실제 Redis로 간다. */
  function stubbed(
    overrides: Record<string, unknown>,
    clock: ClockService = new ClockService(),
  ): TokenBlacklistService {
    const proxy = new Proxy(redis, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && prop in overrides) {
          return overrides[prop];
        }
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    return new TokenBlacklistService(
      proxy,
      config,
      alerts as unknown as AlertService,
      clock,
    );
  }

  beforeAll(async () => {
    redis = await connectTestRedis();
    const module = await Test.createTestingModule({
      providers: [
        TokenBlacklistService,
        ...redisTestProviders(redis),
        { provide: AlertService, useValue: alerts },
        ClockService,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(TokenBlacklistService);
  });
  afterAll(async () => {
    await redis.quit();
  });
  beforeEach(async () => {
    await redis.flushdb();
    await service.markReady(await service.generation());
    alerts.notify.mockClear();
  });

  it('credentialCutoffSec는 초 단위 내림 — iat와 같은 정밀도로 비교하기 위해', () => {
    expect(credentialCutoffSec(T1)).toBe(1_790_337_600);
  });

  // 쓰기는 전부 "버전(변경 시각)이 더 새로울 때만" — 훅·재구축·조정이 어떤 순서로 겹쳐도 최근 변경이 이긴다
  describe('상태 키(정지·탈퇴·복구)', () => {
    it('blockStatus하면 사유가 조회되고 더 새 버전의 clearStatus로 풀린다', async () => {
      await expect(
        service.blockStatus(BigInt(7), 'SUSPENDED', T1),
      ).resolves.toBe(true);

      await expect(service.lookup(BigInt(7))).resolves.toEqual({
        ready: true,
        status: 'SUSPENDED',
        credentialCutoffSec: null,
      });
      await expect(service.lookup(BigInt(8))).resolves.toMatchObject({
        status: null,
      });

      await service.clearStatus(BigInt(7), T2);
      await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
        status: null,
      });
      expect(await redis.get('auth:blk:st:7')).toBe(`ACTIVE:${T2.getTime()}`);
    });

    it('반증: 복구 뒤 도착한 옛 버전의 정지(재구축 스냅샷)는 무시된다', async () => {
      await service.clearStatus(BigInt(7), T2);
      await service.blockStatus(BigInt(7), 'SUSPENDED', T1);

      await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
        status: null,
      });
    });

    it('반증: 옛 버전의 복구(조정 스냅샷)는 더 새 정지를 덮지 못한다', async () => {
      await service.blockStatus(BigInt(7), 'SUSPENDED', T3);
      await service.clearStatus(BigInt(7), T2);

      await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
        status: 'SUSPENDED',
      });
    });

    it('복구 뒤 더 새 버전으로 다시 정지하면 막힌다', async () => {
      await service.clearStatus(BigInt(7), T1);
      await service.blockStatus(BigInt(7), 'DELETED', T2);

      await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
        status: 'DELETED',
      });
    });

    it('반증: 복구는 자격증명 cutoff를 지우지 않는다 — 옛 비밀번호로 받은 토큰은 계속 막혀야 한다', async () => {
      await service.blockCredentials(BigInt(7), T1);
      await service.blockStatus(BigInt(7), 'SUSPENDED', T2);
      await service.clearStatus(BigInt(7), T3);

      await expect(service.lookup(BigInt(7))).resolves.toEqual({
        ready: true,
        status: null,
        credentialCutoffSec: credentialCutoffSec(T1),
      });
    });

    it('blockedStatusAccountIds는 지금 막고 있는 계정만 돌려준다(복구 기록·cutoff만 있는 계정 제외)', async () => {
      await service.blockStatus(BigInt(7), 'SUSPENDED', T1);
      await service.blockStatus(BigInt(8), 'DELETED', T1);
      await service.clearStatus(BigInt(9), T1);
      await service.blockCredentials(BigInt(10), T1);

      const ids = await service.blockedStatusAccountIds();
      expect(ids.map(String).sort()).toEqual(['7', '8']);
    });

    it('반증: 한 페이지보다 많은 키도 커서로 전부 순회한다', async () => {
      const total = STATUS_SCAN_PAGE + 50;
      for (let i = 1; i <= total; i++) {
        await service.blockStatus(BigInt(i), 'SUSPENDED', T1);
      }

      const ids = await service.blockedStatusAccountIds();
      expect(new Set(ids.map(String)).size).toBe(total);
    });
  });

  describe('자격증명 cutoff', () => {
    it('변경 시각을 초 단위 cutoff로 저장한다', async () => {
      await service.blockCredentials(BigInt(7), T1);
      await expect(service.lookup(BigInt(7))).resolves.toEqual({
        ready: true,
        status: null,
        credentialCutoffSec: credentialCutoffSec(T1),
      });
    });

    it('반증: cutoff는 낮아지지 않는다 — 재구축의 옛 스냅샷이 최신 변경을 덮지 않게', async () => {
      await service.blockCredentials(BigInt(7), T2);
      await service.blockCredentials(BigInt(7), T1);

      await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
        credentialCutoffSec: credentialCutoffSec(T2),
      });

      await service.blockCredentials(BigInt(7), T3);
      await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
        credentialCutoffSec: credentialCutoffSec(T3),
      });
    });
  });

  // 표식은 임대다 — 재구축이 주기마다 갱신하고, 스냅샷 뒤 쓰기 실패가 끼어들었으면(세대 변화) 세우지 않는다
  describe('완전성 표식', () => {
    it('markReady는 세대가 스냅샷 때와 같을 때만 세우고 임대 TTL을 건다', async () => {
      await redis.del(BLACKLIST_READY_KEY);
      const generation = await service.generation();

      await expect(service.markReady(generation)).resolves.toBe(true);

      const ttl = await redis.ttl(BLACKLIST_READY_KEY);
      expect(ttl).toBeGreaterThan(BLACKLIST_READY_TTL_SECONDS - 5);
      expect(ttl).toBeLessThanOrEqual(BLACKLIST_READY_TTL_SECONDS);
    });

    it('반증: 스냅샷 뒤 다른 프로세스의 쓰기 실패가 끼어들면 세대가 달라져 세우지 않는다', async () => {
      const generation = await service.generation();
      const flaky = stubbed({ eval: down });
      await flaky.blockStatus(BigInt(1), 'SUSPENDED', T1); // 실패한 훅

      await expect(service.markReady(generation)).resolves.toBe(false);
      await expect(service.lookup(BigInt(1))).resolves.toMatchObject({
        ready: false,
      });
      expect(await service.generation()).not.toBe(generation);
    });

    it('반증: 세대 키를 만들어 두므로 빈 Redis(재구축 도중 재시작)에서는 세우지 않는다', async () => {
      const generation = await service.generation();
      expect(await redis.exists('auth:blk:dirty')).toBe(1);

      await redis.flushdb();

      await expect(service.markReady(generation)).resolves.toBe(false);
      expect(await redis.exists(BLACKLIST_READY_KEY)).toBe(0);
    });

    it('invalidateReady는 표식을 지운다 — 목록을 믿을 수 없다고 판단한 쪽이 부른다', async () => {
      await expect(service.invalidateReady()).resolves.toBe(true);
      expect(await redis.exists(BLACKLIST_READY_KEY)).toBe(0);
    });

    it('테스트 컨테이너(기본 설정)는 축출 위험이 없다', async () => {
      await expect(service.evictionRisk()).resolves.toBeNull();
    });

    // 축출 정책 전수 — maxmemory가 있으면 noeviction만 안전
    it.each([
      ['0', 'allkeys-lru', null],
      ['0', 'volatile-ttl', null],
      ['104857600', 'noeviction', null],
      [
        '104857600',
        'volatile-lru',
        'maxmemory=104857600 maxmemory-policy=volatile-lru — noeviction이어야 한다',
      ],
      [
        '104857600',
        'allkeys-random',
        'maxmemory=104857600 maxmemory-policy=allkeys-random — noeviction이어야 한다',
      ],
    ])(
      'evictionRisk: maxmemory=%s policy=%s → %s',
      async (maxmemory, policy, expected) => {
        const stub = stubbed({
          config: (_: string, name: string) =>
            Promise.resolve([name, name === 'maxmemory' ? maxmemory : policy]),
        });
        await expect(stub.evictionRisk()).resolves.toBe(expected);
      },
    );

    it('반증: CONFIG GET 응답을 해석할 수 없으면 던진다(안전한 쪽 — 재구축 실패)', async () => {
      const stub = stubbed({ config: () => Promise.resolve('OK') });
      await expect(stub.evictionRisk()).rejects.toThrow('CONFIG GET maxmemory');
    });
  });

  it('반증: 재구축 표식이 없으면 ready=false — 목록이 불완전하다는 뜻', async () => {
    await redis.del(BLACKLIST_READY_KEY);
    await service.blockStatus(BigInt(7), 'DELETED', T1);
    await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
      ready: false,
      status: 'DELETED',
    });
  });

  it('두 키 다 액세스 토큰 수명만큼 산다 — 그 뒤엔 토큰 자체가 만료라 볼 필요가 없다', async () => {
    await service.blockStatus(BigInt(7), 'DELETED', T1);
    await service.blockCredentials(BigInt(7), T1);
    for (const key of ['auth:blk:st:7', 'auth:blk:cr:7']) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(TTL - 5);
      expect(ttl).toBeLessThanOrEqual(TTL);
    }
  });

  it('반증: 연결이 ready가 아니면(재접속 중) MGET을 기다리지 않고 즉시 던진다 — 인증 경로가 commandTimeout만큼 멈추지 않게', async () => {
    const mget = jest.fn();
    const stub = stubbed({ status: 'reconnecting', mget });

    await expect(stub.lookup(BigInt(1))).rejects.toThrow('reconnecting');
    expect(mget).not.toHaveBeenCalled();
  });

  // 쓰기 실패는 던지지 않는다(도메인 커밋은 끝난 뒤) — 대신 경보 + 표식 제거로 전략을 DB 폴백으로 보내고 false
  describe('쓰기 실패', () => {
    it('반증: EVAL만 실패하면 쓰기 3종 false + 경보, 표식이 지워져 ready=false, 세대가 오른다', async () => {
      const broken = stubbed({ eval: down });
      await expect(service.lookup(BigInt(1))).resolves.toMatchObject({
        ready: true,
      });

      await expect(
        broken.blockStatus(BigInt(1), 'SUSPENDED', T1),
      ).resolves.toBe(false);
      await expect(broken.clearStatus(BigInt(1), T2)).resolves.toBe(false);
      await expect(broken.blockCredentials(BigInt(1), T1)).resolves.toBe(false);

      expect(alerts.notify).toHaveBeenCalledTimes(3);
      expect(alerts.notify).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'auth-blacklist-write' }),
      );
      await expect(service.lookup(BigInt(1))).resolves.toMatchObject({
        ready: false,
      });
      expect(await service.generation()).toBe('3'); // 실패마다 세대가 오른다
    });

    it('반증: 세대를 올린 뒤 표식을 지운다 — 반대 순서면 그 사이 옛 세대의 markReady가 표식을 되살린다', async () => {
      const generation = await service.generation();
      const order: string[] = [];
      const broken = stubbed({
        eval: down,
        incr: (key: string) => {
          order.push('incr');
          return redis.incr(key);
        },
        del: async (key: string) => {
          // INCR과 DEL 사이에 옛 세대의 재구축이 표식을 세우려 한다 — 세대가 이미 올라 실패해야 한다
          expect(await service.markReady(generation)).toBe(false);
          order.push('del');
          return redis.del(key);
        },
      });

      await expect(
        broken.blockStatus(BigInt(1), 'SUSPENDED', T1),
      ).resolves.toBe(false);

      expect(order).toEqual(['incr', 'del']);
      expect(await redis.exists(BLACKLIST_READY_KEY)).toBe(0);
    });

    it('반증: 쓰기만 거부되는 상태(OOM+noeviction·READONLY)에서도 단독 DEL로 표식은 지워진다', async () => {
      const oom = () => Promise.reject(new Error('OOM command not allowed'));
      const broken = stubbed({ eval: oom, incr: oom });

      await expect(
        broken.blockStatus(BigInt(1), 'SUSPENDED', T1),
      ).resolves.toBe(false);

      expect(await redis.exists(BLACKLIST_READY_KEY)).toBe(0);
      expect(await service.generation()).toBe('0'); // INCR은 거부됐지만 표식이 없어 재구축 전까지 DB 폴백
    });

    it('반증: 표식 제거까지 실패하면 이 프로세스는 임대 시간 동안 ready=false로 스스로 폴백하고, 제거가 다시 성공하면 풀린다', async () => {
      let nowMs = T1.getTime();
      let delFails = true;
      const mget = jest.fn((...keys: string[]) => redis.mget(...keys));
      const broken = stubbed(
        {
          eval: down,
          mget,
          del: (key: string) => (delFails ? down() : redis.del(key)),
        },
        { nowMs: () => nowMs } as unknown as ClockService,
      );

      await expect(
        broken.blockStatus(BigInt(1), 'SUSPENDED', T1),
      ).resolves.toBe(false);
      expect(await redis.exists(BLACKLIST_READY_KEY)).toBe(1); // 표식은 못 지웠다

      // 열화 창 안: DEL을 다시 시도하고, 실패하면 MGET 없이 ready=false
      await expect(broken.lookup(BigInt(1))).resolves.toEqual({
        ready: false,
        status: null,
        credentialCutoffSec: null,
      });
      expect(mget).not.toHaveBeenCalled();

      // 창이 끝나면 다시 Redis를 믿는다(다른 프로세스는 임대 만료로 수렴)
      nowMs += BLACKLIST_READY_TTL_SECONDS * 1000;
      await expect(broken.lookup(BigInt(1))).resolves.toMatchObject({
        ready: true,
      });
      expect(mget).toHaveBeenCalledTimes(1);

      // 창 안에서 DEL이 성공하면 즉시 풀린다 — 표식이 지워졌으니 ready=false는 정상 경로
      nowMs = T1.getTime();
      await expect(
        broken.blockStatus(BigInt(1), 'SUSPENDED', T1),
      ).resolves.toBe(false);
      delFails = false;
      await expect(broken.lookup(BigInt(1))).resolves.toMatchObject({
        ready: false,
      });
      expect(mget).toHaveBeenCalledTimes(2);
      expect(await redis.exists(BLACKLIST_READY_KEY)).toBe(0);
      await service.markReady(await service.generation());
      await expect(broken.lookup(BigInt(1))).resolves.toMatchObject({
        ready: true,
      });
    });

    it('반증: Redis가 통째로 죽으면 쓰기는 false·경보, 읽기·세대·표식은 던진다', async () => {
      const dead = {
        status: 'ready',
        eval: down,
        mget: down,
        scan: down,
        get: down,
        set: down,
        del: down,
        incr: down,
      } as unknown as Redis;
      const broken = new TokenBlacklistService(
        dead,
        config,
        alerts as unknown as AlertService,
        new ClockService(),
      );

      await expect(
        broken.blockStatus(BigInt(1), 'SUSPENDED', T1),
      ).resolves.toBe(false);
      expect(alerts.notify).toHaveBeenCalledTimes(1);
      await expect(broken.blockedStatusAccountIds()).rejects.toThrow('down');
      await expect(broken.generation()).rejects.toThrow('down');
      await expect(broken.markReady('0')).rejects.toThrow('down');
      // 열화 창 안이라 조회는 DEL 재시도 실패 → ready=false(폴백)
      await expect(broken.lookup(BigInt(1))).resolves.toMatchObject({
        ready: false,
      });
    });
  });
});
