import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';

import { AlertService } from '@/global/alerting';
import {
  BLACKLIST_READY_KEY,
  credentialCutoffSec,
  TokenBlacklistService,
} from '@/global/auth/blacklist/token-blacklist.service';
import { TEST_AUTH_CONFIG } from '@/test/auth-config';
import { connectTestRedis } from '@/test/db/redis-test-client';
import { redisTestProviders } from '@/test/redis';

const T1 = new Date('2026-09-25T12:00:00.500Z');
const T2 = new Date(T1.getTime() + 30_000);
const T3 = new Date(T2.getTime() + 30_000);
const TTL = TEST_AUTH_CONFIG.jwtAccessExpiresSeconds;

describe('TokenBlacklistService (real Redis)', () => {
  let service: TokenBlacklistService;
  let redis: Redis;
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };

  beforeAll(async () => {
    redis = await connectTestRedis();
    const module = await Test.createTestingModule({
      providers: [
        TokenBlacklistService,
        ...redisTestProviders(redis),
        { provide: AlertService, useValue: alerts },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => TEST_AUTH_CONFIG },
        },
      ],
    }).compile();
    service = module.get(TokenBlacklistService);
  });
  afterAll(async () => {
    await redis.quit();
  });
  beforeEach(async () => {
    await redis.flushdb();
    await service.markReady();
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

  // 쓰기 실패는 던지지 않는다(도메인 커밋은 끝난 뒤) — 대신 경보 + 표식 제거로 전략을 DB 폴백으로 보내고 false
  describe('쓰기 실패', () => {
    const down = () => Promise.reject(new Error('down'));

    it('반증: 쓰기 3종 전부 false + 경보, 표식이 지워져 ready=false가 된다 — 빠진 키를 활성으로 믿지 않게', async () => {
      // EVAL만 죽고 나머지는 실제 Redis — 표식 제거가 실제로 일어나는지 본다
      const flaky = {
        eval: down,
        del: (key: string) => redis.del(key),
        mget: (...keys: string[]) => redis.mget(...keys),
      } as unknown as Redis;
      const broken = new TokenBlacklistService(
        flaky,
        { getOrThrow: () => TEST_AUTH_CONFIG } as unknown as ConfigService,
        alerts as unknown as AlertService,
      );
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
      await expect(broken.lookup(BigInt(1))).resolves.toMatchObject({
        ready: false,
      });
    });

    it('반증: Redis가 통째로 죽으면 쓰기는 false·경보, 읽기는 던진다(전략이 폴백)', async () => {
      const dead = {
        eval: down,
        mget: down,
        scan: down,
        del: down,
      } as unknown as Redis;
      const broken = new TokenBlacklistService(
        dead,
        { getOrThrow: () => TEST_AUTH_CONFIG } as unknown as ConfigService,
        alerts as unknown as AlertService,
      );

      await expect(
        broken.blockStatus(BigInt(1), 'SUSPENDED', T1),
      ).resolves.toBe(false);
      expect(alerts.notify).toHaveBeenCalledTimes(1);
      await expect(broken.lookup(BigInt(1))).rejects.toThrow('down');
      await expect(broken.blockedStatusAccountIds()).rejects.toThrow('down');
    });
  });
});
