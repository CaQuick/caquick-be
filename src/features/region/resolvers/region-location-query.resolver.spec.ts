import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { ClockService } from '@/common/providers/clock.service';
import { LocationAccessLogRepository } from '@/features/region/repositories/location-access-log.repository';
import { RegionRepository } from '@/features/region/repositories/region.repository';
import { RegionLocationQueryResolver } from '@/features/region/resolvers/region-location-query.resolver';
import { LocationAccessLogService } from '@/features/region/services/location-access-log.service';
import { RegionLocationService } from '@/features/region/services/region-location.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { OptionalJwtAuthGuard } from '@/global/auth';
import { KAKAO_LOCAL_TRANSPORT } from '@/global/kakao-local';
import { RateLimitGuard } from '@/global/rate-limit';
import { RATE_LIMIT_METADATA_KEY } from '@/global/rate-limit/rate-limit.guard';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { connectTestRedis } from '@/test/db/redis-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createRegion } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { redisTestProviders } from '@/test/redis';

// 분기 세부 검증은 region-location.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로와 가드 배선만 본다.
describe('RegionLocationQueryResolver (real DB)', () => {
  let resolver: RegionLocationQueryResolver;
  let prisma: PrismaClient;
  let redis: Redis;
  const transport = jest.fn<Promise<Response>, [string, RequestInit]>();

  beforeAll(async () => {
    redis = await connectTestRedis();
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        RegionLocationQueryResolver,
        RegionLocationService,
        RegionRepository,
        LocationAccessLogService,
        LocationAccessLogRepository,
        ClockService,
        {
          provide: ConfigService,
          useValue: { get: () => ({ restApiKey: 'rest-key' }) },
        },
        ...redisTestProviders(redis),
        { provide: KAKAO_LOCAL_TRANSPORT, useValue: transport },
      ],
    });
    resolver = module.get(RegionLocationQueryResolver);
    prisma = p;
  });
  afterAll(async () => {
    await redis.quit();
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
    await redis.flushdb();
    transport.mockReset();
  });

  it('로그인 사용자의 현재 위치로 1·2차 지역을 찾고 계정으로 이용 사실을 남긴다', async () => {
    const account = await createAccount(prisma);
    const group = await createRegion(prisma, { level: 1, slug: 'incheon' });
    const district = await createRegion(prisma, {
      level: 2,
      parent_id: group.id,
      name: '영종구',
      slug: 'sgg-28155',
    });
    transport.mockResolvedValue(
      new Response(
        JSON.stringify({
          documents: [{ region_type: 'B', code: '2815510100' }],
        }),
      ),
    );

    const result = await resolver.regionByLocation(
      { latitude: 37.4602, longitude: 126.4407 },
      { accountId: account.id.toString(), accountType: 'USER' },
    );

    expect(result?.group.id).toBe(group.id.toString());
    expect(result?.region.id).toBe(district.id.toString());
    const [log] = await prisma.locationAccessLog.findMany();
    expect(log.account_id).toBe(account.id);
  });

  it('IP 레이트리밋을 옵셔널 인증보다 먼저 건다', () => {
    const handler = RegionLocationQueryResolver.prototype.regionByLocation;

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      RateLimitGuard,
      OptionalJwtAuthGuard,
    ]);
    expect(Reflect.getMetadata(RATE_LIMIT_METADATA_KEY, handler)).toEqual({
      name: 'region-by-location',
      limit: 30,
      windowSeconds: 60,
    });
  });
});
