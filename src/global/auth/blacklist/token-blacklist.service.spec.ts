import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';

import { AlertService } from '@/global/alerting';
import {
  BLACKLIST_READY_KEY,
  TokenBlacklistService,
} from '@/global/auth/blacklist/token-blacklist.service';
import { TEST_AUTH_CONFIG } from '@/test/auth-config';
import { connectTestRedis } from '@/test/db/redis-test-client';
import { redisTestProviders } from '@/test/redis';

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
    alerts.notify.mockClear();
  });

  it('block하면 사유가 조회되고(정지·탈퇴는 전체 차단), unblock하면 사라진다', async () => {
    await service.markReady();
    await service.block(BigInt(7), 'SUSPENDED');

    await expect(service.lookup(BigInt(7))).resolves.toEqual({
      ready: true,
      entry: { reason: 'SUSPENDED', issuedBeforeMs: Number.POSITIVE_INFINITY },
    });
    await expect(service.lookup(BigInt(8))).resolves.toEqual({
      ready: true,
      entry: null,
    });

    await service.unblock(BigInt(7));
    await expect(service.lookup(BigInt(7))).resolves.toEqual({
      ready: true,
      entry: null,
    });
  });

  it('자격증명 변경은 cutoff(ms)를 함께 저장한다 — 그 뒤 발급된 토큰은 통과시키기 위해', async () => {
    await service.block(BigInt(7), 'CREDENTIAL_CHANGED', {
      issuedBeforeMs: 1_700_000_000_000,
    });
    await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
      entry: {
        reason: 'CREDENTIAL_CHANGED',
        issuedBeforeMs: 1_700_000_000_000,
      },
    });
  });

  it('반증: 재구축 표식이 없으면 ready=false — 목록이 불완전하다는 뜻', async () => {
    await service.block(BigInt(7), 'DELETED');
    await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
      ready: false,
    });
    expect(await redis.exists(BLACKLIST_READY_KEY)).toBe(0);
  });

  it('TTL 기본값은 액세스 토큰 수명이다 — 그 뒤엔 토큰 자체가 만료라 볼 필요가 없다', async () => {
    await service.block(BigInt(7), 'DELETED');
    const ttl = await redis.ttl('auth:blk:7');
    expect(ttl).toBeGreaterThan(TEST_AUTH_CONFIG.jwtAccessExpiresSeconds - 5);
    expect(ttl).toBeLessThanOrEqual(TEST_AUTH_CONFIG.jwtAccessExpiresSeconds);
  });

  it('반증: TTL이 지나면 저절로 풀린다', async () => {
    await service.markReady();
    await service.block(BigInt(7), 'CREDENTIAL_CHANGED', { ttlSeconds: 1 });
    await expect(service.lookup(BigInt(7))).resolves.toMatchObject({
      entry: { reason: 'CREDENTIAL_CHANGED' },
    });
    await new Promise((r) => setTimeout(r, 1_100));
    await expect(service.lookup(BigInt(7))).resolves.toEqual({
      ready: true,
      entry: null,
    });
  });

  it('반증: 등록이 실패해도 던지지 않고 경보만 남긴다(도메인 커밋은 끝난 뒤라) — lookup은 던진다', async () => {
    const dead = {
      set: () => Promise.reject(new Error('down')),
      mget: () => Promise.reject(new Error('down')),
      del: () => Promise.reject(new Error('down')),
    } as unknown as Redis;
    const broken = new TokenBlacklistService(
      dead,
      { getOrThrow: () => TEST_AUTH_CONFIG } as unknown as ConfigService,
      alerts as unknown as AlertService,
    );

    await expect(broken.block(BigInt(1), 'SUSPENDED')).resolves.toBeUndefined();
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'auth-blacklist-write' }),
    );
    await expect(broken.unblock(BigInt(1))).resolves.toBeUndefined();
    await expect(broken.lookup(BigInt(1))).rejects.toThrow('down');
  });
});
