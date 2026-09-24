import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';

import { TokenBlacklistService } from '@/global/auth/blacklist/token-blacklist.service';
import { TEST_AUTH_CONFIG } from '@/test/auth-config';
import { connectTestRedis } from '@/test/db/redis-test-client';
import { redisTestProviders } from '@/test/redis';

describe('TokenBlacklistService (real Redis)', () => {
  let service: TokenBlacklistService;
  let redis: Redis;

  beforeAll(async () => {
    redis = await connectTestRedis();
    const module = await Test.createTestingModule({
      providers: [
        TokenBlacklistService,
        ...redisTestProviders(redis),
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
  });

  it('block하면 사유가 조회되고, unblock하면 사라진다', async () => {
    await service.block(BigInt(7), 'SUSPENDED');
    await expect(service.blockedReason(BigInt(7))).resolves.toBe('SUSPENDED');
    await expect(service.blockedReason(BigInt(8))).resolves.toBeNull();

    await service.unblock(BigInt(7));
    await expect(service.blockedReason(BigInt(7))).resolves.toBeNull();
  });

  it('TTL 기본값은 액세스 토큰 수명이다 — 그 뒤엔 토큰 자체가 만료라 볼 필요가 없다', async () => {
    await service.block(BigInt(7), 'DELETED');
    const ttl = await redis.ttl('auth:blk:7');
    expect(ttl).toBeGreaterThan(TEST_AUTH_CONFIG.jwtAccessExpiresSeconds - 5);
    expect(ttl).toBeLessThanOrEqual(TEST_AUTH_CONFIG.jwtAccessExpiresSeconds);
  });

  it('반증: TTL이 지나면 저절로 풀린다', async () => {
    await service.block(BigInt(7), 'CREDENTIAL_CHANGED', 1);
    await expect(service.blockedReason(BigInt(7))).resolves.toBe(
      'CREDENTIAL_CHANGED',
    );
    await new Promise((r) => setTimeout(r, 1_100));
    await expect(service.blockedReason(BigInt(7))).resolves.toBeNull();
  });
});
