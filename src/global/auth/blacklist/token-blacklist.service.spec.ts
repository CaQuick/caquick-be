import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';

import { AlertService } from '@/global/alerting';
import {
  BLACKLIST_READY_KEY,
  credentialCutoffSec,
  REINSTATED_TTL_SECONDS,
  TokenBlacklistService,
} from '@/global/auth/blacklist/token-blacklist.service';
import { TEST_AUTH_CONFIG } from '@/test/auth-config';
import { connectTestRedis } from '@/test/db/redis-test-client';
import { redisTestProviders } from '@/test/redis';

const CHANGED_AT = new Date('2026-09-25T12:00:00.500Z');
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
    expect(credentialCutoffSec(CHANGED_AT)).toBe(1_790_337_600);
  });

  describe('상태 키(정지·탈퇴)', () => {
    it('blockStatus하면 사유가 조회되고 clearStatus하면 사라진다', async () => {
      await service.blockStatus(BigInt(7), 'SUSPENDED');

      await expect(service.lookup(BigInt(7))).resolves.toEqual({
        ready: true,
        status: 'SUSPENDED',
        credentialCutoffSec: null,
      });
      await expect(service.lookup(BigInt(8))).resolves.toMatchObject({
        status: null,
      });

      await service.clearStatus(BigInt(7));
      await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
        status: null,
      });
    });

    it('반증: 복구는 자격증명 cutoff를 지우지 않는다 — 옛 비밀번호로 받은 토큰은 계속 막혀야 한다', async () => {
      await service.blockCredentials(BigInt(7), CHANGED_AT);
      await service.blockStatus(BigInt(7), 'SUSPENDED');
      await service.clearStatus(BigInt(7));

      await expect(service.lookup(BigInt(7))).resolves.toEqual({
        ready: true,
        status: null,
        credentialCutoffSec: credentialCutoffSec(CHANGED_AT),
      });
    });

    it('복구 표식은 재구축 주기의 2배만 산다 — 그 안의 재구축이 옛 스냅샷으로 정지를 되살리지 않게', async () => {
      await service.clearStatus(BigInt(7));

      expect(
        await service.blockStatusUnlessReinstated(BigInt(7), 'SUSPENDED'),
      ).toBe(false);
      await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
        status: null,
      });
      const ttl = await redis.ttl('auth:blk:ok:7');
      expect(ttl).toBeGreaterThan(REINSTATED_TTL_SECONDS - 5);
      expect(ttl).toBeLessThanOrEqual(REINSTATED_TTL_SECONDS);
    });

    it('반증: 표식이 없으면 재구축이 등록한다 / 다시 정지하면 표식을 걷는다', async () => {
      expect(
        await service.blockStatusUnlessReinstated(BigInt(7), 'SUSPENDED'),
      ).toBe(true);
      await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
        status: 'SUSPENDED',
      });

      await service.clearStatus(BigInt(7));
      await service.blockStatus(BigInt(7), 'SUSPENDED');
      expect(await redis.exists('auth:blk:ok:7')).toBe(0);
    });
  });

  describe('자격증명 cutoff', () => {
    it('변경 시각을 초 단위 cutoff로 저장한다', async () => {
      await service.blockCredentials(BigInt(7), CHANGED_AT);
      await expect(service.lookup(BigInt(7))).resolves.toEqual({
        ready: true,
        status: null,
        credentialCutoffSec: credentialCutoffSec(CHANGED_AT),
      });
    });

    it('반증: cutoff는 낮아지지 않는다 — 재구축의 옛 스냅샷이 최신 변경을 덮지 않게', async () => {
      const later = new Date(CHANGED_AT.getTime() + 30_000);
      await service.blockCredentials(BigInt(7), later);
      await service.blockCredentials(BigInt(7), CHANGED_AT);

      await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
        credentialCutoffSec: credentialCutoffSec(later),
      });

      // 더 늦은 변경은 올린다
      const latest = new Date(later.getTime() + 30_000);
      await service.blockCredentials(BigInt(7), latest);
      await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
        credentialCutoffSec: credentialCutoffSec(latest),
      });
    });
  });

  it('반증: 재구축 표식이 없으면 ready=false — 목록이 불완전하다는 뜻', async () => {
    await redis.del(BLACKLIST_READY_KEY);
    await service.blockStatus(BigInt(7), 'DELETED');
    await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
      ready: false,
      status: 'DELETED',
    });
  });

  it('두 키 다 액세스 토큰 수명만큼 산다 — 그 뒤엔 토큰 자체가 만료라 볼 필요가 없다', async () => {
    await service.blockStatus(BigInt(7), 'DELETED');
    await service.blockCredentials(BigInt(7), CHANGED_AT);
    for (const key of ['auth:blk:st:7', 'auth:blk:cr:7']) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(TTL - 5);
      expect(ttl).toBeLessThanOrEqual(TTL);
    }
  });

  it('반증: 등록·해제가 실패해도 던지지 않고 경보만 남긴다(도메인 커밋은 끝난 뒤라) — lookup은 던진다', async () => {
    const down = () => Promise.reject(new Error('down'));
    const dead = {
      multi: () => ({ set: () => ({ del: () => ({ exec: down }) }) }),
      eval: down,
      exists: down,
      mget: down,
    } as unknown as Redis;
    const broken = new TokenBlacklistService(
      dead,
      { getOrThrow: () => TEST_AUTH_CONFIG } as unknown as ConfigService,
      alerts as unknown as AlertService,
    );

    await expect(
      broken.blockStatus(BigInt(1), 'SUSPENDED'),
    ).resolves.toBeUndefined();
    await expect(
      broken.blockCredentials(BigInt(1), CHANGED_AT),
    ).resolves.toBeUndefined();
    expect(alerts.notify).toHaveBeenCalledTimes(2);
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'auth-blacklist-write' }),
    );
    await expect(broken.lookup(BigInt(1))).rejects.toThrow('down');
  });
});
