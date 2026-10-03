import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { ClockService } from '@/common/providers/clock.service';
import { LocationAccessLogRepository } from '@/features/region/repositories/location-access-log.repository';
import { RegionRepository } from '@/features/region/repositories/region.repository';
import { LocationAccessLogService } from '@/features/region/services/location-access-log.service';
import {
  nextCacheExpiry,
  RegionLocationService,
} from '@/features/region/services/region-location.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { KAKAO_LOCAL_TRANSPORT } from '@/global/kakao-local';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { connectTestRedis } from '@/test/db/redis-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createRegion } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { redisTestProviders } from '@/test/redis';

const NOW = new Date('2026-10-03T19:00:00.000Z');
const SEOUL_CITY_HALL = { latitude: 37.5665, longitude: 126.978 };

function regionDocs(bCode: string | null, hCode: string | null = null) {
  return {
    documents: [
      ...(bCode ? [{ region_type: 'B', code: bCode }] : []),
      ...(hCode ? [{ region_type: 'H', code: hCode }] : []),
    ],
  };
}

describe('RegionLocationService (real DB)', () => {
  let service: RegionLocationService;
  let prisma: PrismaClient;
  let redis: Redis;
  let apiKey: string | undefined;
  let now = NOW;
  const transport = jest.fn<Promise<Response>, [string, RequestInit]>();

  /** 실제 클라이언트에서 get·set만 실패시킨다. */
  const redisDown = (): Redis =>
    new Proxy(redis, {
      get(target, prop, receiver) {
        if (prop === 'get' || prop === 'set') {
          return () => Promise.reject(new Error('redis down'));
        }
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });

  async function build(client: Redis): Promise<RegionLocationService> {
    const { module } = await createTestingModuleWithRealDb({
      providers: [
        RegionLocationService,
        RegionRepository,
        LocationAccessLogService,
        LocationAccessLogRepository,
        { provide: ClockService, useValue: { now: () => now } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'kakaoLocal' ? { restApiKey: apiKey } : undefined,
          },
        },
        ...redisTestProviders(client),
        { provide: KAKAO_LOCAL_TRANSPORT, useValue: transport },
      ],
    });
    return module.get(RegionLocationService);
  }

  beforeAll(async () => {
    redis = await connectTestRedis();
    service = await build(redis);
    ({ prisma } = await createTestingModuleWithRealDb({ providers: [] }));
  });
  afterAll(async () => {
    await redis.quit();
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
    await redis.flushdb();
    apiKey = 'rest-key';
    now = NOW;
    transport.mockReset();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function kakaoReplies(body: unknown, status = 200): void {
    transport.mockImplementation(() =>
      Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
        }),
      ),
    );
  }

  async function seedDistrict(
    slug: string,
    opts: {
      district?: { is_active?: boolean; deleted?: boolean };
      group?: { is_active?: boolean; deleted?: boolean };
    } = {},
  ) {
    const group = await createRegion(prisma, {
      level: 1,
      name: '서울 북부',
      slug: `group-${slug}`,
      is_active: opts.group?.is_active ?? true,
    });
    const district = await createRegion(prisma, {
      level: 2,
      parent_id: group.id,
      name: '중구',
      slug,
      is_active: opts.district?.is_active ?? true,
    });
    if (opts.group?.deleted) {
      await prisma.region.update({
        where: { id: group.id },
        data: { deleted_at: NOW },
      });
    }
    if (opts.district?.deleted) {
      await prisma.region.update({
        where: { id: district.id },
        data: { deleted_at: NOW },
      });
    }
    return { group, district };
  }

  describe('매칭', () => {
    it('좌표가 속한 2차 지역과 상위 1차를 돌려주고, 카카오에는 x=경도·y=위도로 묻는다', async () => {
      const { group, district } = await seedDistrict('sgg-11140');
      kakaoReplies(regionDocs('1114010300', '1114055000'));

      const result = await service.regionByLocation(SEOUL_CITY_HALL, null);

      expect(result).toEqual({
        group: {
          id: group.id.toString(),
          name: '서울 북부',
          slug: 'group-sgg-11140',
          hasChildren: true,
        },
        region: {
          id: district.id.toString(),
          parentId: group.id.toString(),
          name: '중구',
          slug: 'sgg-11140',
          level: 2,
        },
      });
      const [url, init] = transport.mock.calls[0];
      const requested = new URL(url);
      expect(requested.origin + requested.pathname).toBe(
        'https://dapi.kakao.com/v2/local/geo/coord2regioncode.json',
      );
      expect(requested.searchParams.get('x')).toBe('126.978');
      expect(requested.searchParams.get('y')).toBe('37.5665');
      expect(init.headers).toEqual({ Authorization: 'KakaoAK rest-key' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('법정동과 행정동이 다른 구를 가리키면 법정동을 따른다', async () => {
      const { district } = await seedDistrict('sgg-11140');
      await seedDistrict('sgg-11110');
      kakaoReplies(regionDocs('1114010300', '1111055000'));

      const result = await service.regionByLocation(SEOUL_CITY_HALL, null);

      expect(result?.region.id).toBe(district.id.toString());
    });

    it('법정동 코드가 없으면 행정동 코드로 찾는다', async () => {
      const { district } = await seedDistrict('sgg-11140');
      kakaoReplies(regionDocs(null, '1114055000'));

      const result = await service.regionByLocation(SEOUL_CITY_HALL, null);

      expect(result?.region.id).toBe(district.id.toString());
    });

    it('법정동 코드가 형식에 맞지 않으면 행정동 코드로 찾는다', async () => {
      const { district } = await seedDistrict('sgg-11140');
      kakaoReplies({
        documents: [
          { region_type: 'B', code: '' },
          { region_type: 'H', code: '1114055000' },
        ],
      });

      const result = await service.regionByLocation(SEOUL_CITY_HALL, null);

      expect(result?.region.id).toBe(district.id.toString());
    });

    it.each([
      ['등록된 지역이 없음', 'sgg-11110', {}],
      ['2차 비활성', 'sgg-11140', { district: { is_active: false } }],
      ['2차 삭제', 'sgg-11140', { district: { deleted: true } }],
      ['1차 비활성', 'sgg-11140', { group: { is_active: false } }],
      ['1차 삭제', 'sgg-11140', { group: { deleted: true } }],
    ])('%s이면 null', async (_label, slug, opts) => {
      await seedDistrict(slug, opts);
      kakaoReplies(regionDocs('1114010300'));

      expect(await service.regionByLocation(SEOUL_CITY_HALL, null)).toBeNull();
    });

    it.each([
      ['빈 결과(바다 등)', { documents: [] }],
      ['시·도 단위 코드', regionDocs('1100000000')],
      ['코드 없음', { documents: [{ region_type: 'B' }] }],
    ])('카카오 %s면 null', async (_label, body) => {
      await seedDistrict('sgg-11140');
      kakaoReplies(body);

      expect(await service.regionByLocation(SEOUL_CITY_HALL, null)).toBeNull();
    });
  });

  describe('국내 범위', () => {
    it.each([
      ['남쪽 밖', 32.999, 127],
      ['북쪽 밖', 39.001, 127],
      ['서쪽 밖', 37, 123.999],
      ['동쪽 밖', 37, 132.001],
      ['해외(뉴욕)', 40.7128, -74.006],
    ])(
      '%s(%p, %p)면 카카오에 묻지 않고 null',
      async (_label, latitude, longitude) => {
        expect(
          await service.regionByLocation({ latitude, longitude }, null),
        ).toBeNull();
        expect(transport).not.toHaveBeenCalled();
      },
    );

    it.each([
      [33, 124],
      [39, 132],
    ])('경계(%p, %p)는 카카오에 묻는다', async (latitude, longitude) => {
      kakaoReplies({ documents: [] });

      await service.regionByLocation({ latitude, longitude }, null);

      expect(transport).toHaveBeenCalledTimes(1);
    });
  });

  describe('카카오 실패', () => {
    it.each([
      ['HTTP 400', () => kakaoReplies({ errorType: 'InvalidArgument' }, 400)],
      ['HTTP 429', () => kakaoReplies({}, 429)],
      ['HTTP 500', () => kakaoReplies('', 500)],
      ['JSON 아님', () => kakaoReplies('<html>')],
      ['documents 없음', () => kakaoReplies({ meta: {} })],
      ['documents가 배열 아님', () => kakaoReplies({ documents: {} })],
      ['문서가 객체 아님', () => kakaoReplies({ documents: [null] })],
      [
        '시간 초과',
        () =>
          transport.mockRejectedValue(
            new DOMException('The operation timed out.', 'TimeoutError'),
          ),
      ],
      [
        '연결 실패',
        () => transport.mockRejectedValue(new TypeError('fetch failed')),
      ],
    ])('%s면 LOCATION_LOOKUP_UNAVAILABLE', async (_label, arrange) => {
      arrange();

      await expect(
        service.regionByLocation(SEOUL_CITY_HALL, null),
      ).rejects.toThrowDomain('LOCATION_LOOKUP_UNAVAILABLE');
    });

    it('키가 없으면 카카오를 부르지 않고 LOCATION_LOOKUP_UNAVAILABLE', async () => {
      apiKey = undefined;

      await expect(
        service.regionByLocation(SEOUL_CITY_HALL, null),
      ).rejects.toThrowDomain('LOCATION_LOOKUP_UNAVAILABLE');
      expect(transport).not.toHaveBeenCalled();
    });

    it('실패 로그에 좌표와 응답 본문을 남기지 않는다', async () => {
      kakaoReplies({ message: 'x=126.978 y=37.5665 out of range' }, 400);

      await expect(
        service.regionByLocation(SEOUL_CITY_HALL, null),
      ).rejects.toThrowDomain('LOCATION_LOOKUP_UNAVAILABLE');

      const logged = jest
        .mocked(Logger.prototype.warn)
        .mock.calls.map((args) => String(args[0]));
      expect(logged).toEqual(['현재 위치 → 지역 변환 실패: HTTP 400']);
    });
  });

  describe('캐시', () => {
    it('같은 약 1m 격자는 카카오에 다시 묻지 않는다', async () => {
      const { district } = await seedDistrict('sgg-11140');
      kakaoReplies(regionDocs('1114010300'));

      // 둘 다 소수 5자리로 반올림하면 (37.56620, 126.97810)
      await service.regionByLocation(
        { latitude: 37.566201, longitude: 126.978101 },
        null,
      );
      const again = await service.regionByLocation(
        { latitude: 37.566204, longitude: 126.978104 },
        null,
      );

      expect(again?.region.id).toBe(district.id.toString());
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it('약 10m 떨어진 점은 따로 물어 경계 건너편 구를 받는다', async () => {
      const { district: north } = await seedDistrict('sgg-11110');
      const { district: south } = await seedDistrict('sgg-11140');
      transport
        .mockResolvedValueOnce(
          new Response(JSON.stringify(regionDocs('1114010300'))),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(regionDocs('1111010100'))),
        );

      const first = await service.regionByLocation(
        { latitude: 37.5662, longitude: 126.9781 },
        null,
      );
      const across = await service.regionByLocation(
        { latitude: 37.5663, longitude: 126.9781 },
        null,
      );

      expect(first?.region.id).toBe(south.id.toString());
      expect(across?.region.id).toBe(north.id.toString());
    });

    it('캐시 키에는 좌표가 없다(격자의 HMAC)', async () => {
      kakaoReplies({ documents: [] });

      await service.regionByLocation(SEOUL_CITY_HALL, null);

      const keys = await redis.keys('region:loc:*');
      expect(keys).toHaveLength(1);
      // base64url 43자 — 소수점·구분자가 없어 격자 좌표가 들어갈 자리가 없다
      expect(keys[0]).toMatch(/^region:loc:[A-Za-z0-9_-]{43}$/);
    });

    it('재기동(새 인스턴스)하면 같은 격자도 다른 키라 이전 캐시를 쓰지 않는다', async () => {
      kakaoReplies({ documents: [] });
      const restarted = await build(redis);

      await service.regionByLocation(SEOUL_CITY_HALL, null);
      await restarted.regionByLocation(SEOUL_CITY_HALL, null);

      expect(await redis.keys('region:loc:*')).toHaveLength(2);
      expect(transport).toHaveBeenCalledTimes(2);
    });

    it('만료 시각은 요청 시각과 무관하게 다음 04:00 KST로 같다', async () => {
      kakaoReplies({ documents: [] });

      now = new Date('2026-10-04T01:00:00.000Z');
      await service.regionByLocation(SEOUL_CITY_HALL, null);
      now = new Date('2026-10-04T11:30:00.000Z');
      await service.regionByLocation(
        { latitude: 37.5702, longitude: 126.9821 },
        null,
      );

      const keys = await redis.keys('region:loc:*');
      const expiries = await Promise.all(
        keys.map((key) => redis.call('PEXPIRETIME', key)),
      );
      expect(keys).toHaveLength(2);
      expect(expiries).toEqual([
        Date.parse('2026-10-04T19:00:00.000Z'),
        Date.parse('2026-10-04T19:00:00.000Z'),
      ]);
    });

    it.each([
      ['KST 오후', '2026-10-03T05:00:00.000Z', '2026-10-03T19:00:00.000Z'],
      ['04시 1ms 전', '2026-10-03T18:59:59.999Z', '2026-10-03T19:00:00.000Z'],
      [
        '정확히 04시면 다음 날',
        '2026-10-03T19:00:00.000Z',
        '2026-10-04T19:00:00.000Z',
      ],
      ['KST 자정 넘김', '2026-10-03T15:30:00.000Z', '2026-10-03T19:00:00.000Z'],
      ['월말', '2026-10-31T20:00:00.000Z', '2026-11-01T19:00:00.000Z'],
    ])('nextCacheExpiry: %s', (_label, at, expected) => {
      expect(nextCacheExpiry(new Date(at)).toISOString()).toBe(expected);
    });

    it('다른 격자는 다시 묻는다', async () => {
      kakaoReplies({ documents: [] });

      await service.regionByLocation(SEOUL_CITY_HALL, null);
      await service.regionByLocation(
        { latitude: 37.56651, longitude: 126.978 },
        null,
      );

      expect(transport).toHaveBeenCalledTimes(2);
    });

    it('지역이 없다는 결과도 캐시한다', async () => {
      kakaoReplies({ documents: [] });

      await service.regionByLocation(SEOUL_CITY_HALL, null);
      expect(await service.regionByLocation(SEOUL_CITY_HALL, null)).toBeNull();

      expect(transport).toHaveBeenCalledTimes(1);
    });

    it('카카오 결과만 캐시하고 지역 활성 여부는 매번 DB에서 본다', async () => {
      const { district } = await seedDistrict('sgg-11140');
      kakaoReplies(regionDocs('1114010300'));
      await service.regionByLocation(SEOUL_CITY_HALL, null);

      await prisma.region.update({
        where: { id: district.id },
        data: { is_active: false },
      });

      expect(await service.regionByLocation(SEOUL_CITY_HALL, null)).toBeNull();
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it('실패는 캐시하지 않는다', async () => {
      kakaoReplies({}, 500);
      await expect(
        service.regionByLocation(SEOUL_CITY_HALL, null),
      ).rejects.toThrowDomain('LOCATION_LOOKUP_UNAVAILABLE');

      kakaoReplies({ documents: [] });
      expect(await service.regionByLocation(SEOUL_CITY_HALL, null)).toBeNull();
      expect(transport).toHaveBeenCalledTimes(2);
    });

    it('Redis 장애면 캐시 없이 카카오로 찾는다', async () => {
      const { district } = await seedDistrict('sgg-11140');
      kakaoReplies(regionDocs('1114010300'));
      const withoutCache = await build(redisDown());

      const result = await withoutCache.regionByLocation(SEOUL_CITY_HALL, null);

      expect(result?.region.id).toBe(district.id.toString());
    });
  });

  describe('위치정보 이용 확인자료', () => {
    it('로그인 이용은 계정과 함께 남긴다', async () => {
      const account = await createAccount(prisma);
      kakaoReplies({ documents: [] });

      await service.regionByLocation(SEOUL_CITY_HALL, account.id);

      expect(
        await prisma.locationAccessLog.findMany({
          select: { account_id: true, purpose: true, created_at: true },
        }),
      ).toEqual([
        {
          account_id: account.id,
          purpose: 'REGION_BY_LOCATION',
          created_at: NOW,
        },
      ]);
    });

    it.each([
      ['국내 범위 밖', { latitude: 0, longitude: 0 }, false],
      ['카카오 장애', SEOUL_CITY_HALL, true],
    ])('%s여도 비로그인 이용 사실을 남긴다', async (_label, input, fails) => {
      kakaoReplies({}, 500);

      const call = service.regionByLocation(input, null);
      if (fails) await expect(call).rejects.toThrowDomain(503);
      else await call;

      const rows = await prisma.locationAccessLog.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].account_id).toBeNull();
    });
  });
});
