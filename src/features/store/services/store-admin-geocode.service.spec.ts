import { ConfigService } from '@nestjs/config';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { KAKAO_LOCAL_TRANSPORT } from '@/features/store/adapters/kakao-local.transport';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import {
  AdminGeocodeService,
  GEOCODE_TIMEOUT_MS,
} from '@/features/store/services/store-admin-geocode.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createRegion } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const ROAD_DOCUMENT = {
  address_name: '서울 강남구 테헤란로 152',
  address_type: 'ROAD_ADDR',
  x: '127.036508620542',
  y: '37.5000242405515',
  address: {
    address_name: '서울 강남구 역삼동 737',
    region_1depth_name: '서울',
    region_2depth_name: '강남구',
    region_3depth_name: '역삼동',
    h_code: '1168064000',
    b_code: '1168010100',
  },
  road_address: {
    address_name: '서울 강남구 테헤란로 152',
    region_1depth_name: '서울',
    region_2depth_name: '강남구',
    region_3depth_name: '역삼동',
  },
};

function kakaoResponse(documents: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ meta: {}, documents }), { status });
}

function timeoutError(): Error {
  return Object.assign(new Error('The operation was aborted due to timeout'), {
    name: 'TimeoutError',
  });
}

describe('AdminGeocodeService (real DB)', () => {
  let service: AdminGeocodeService;
  let prisma: PrismaClient;
  let restApiKey: string | undefined;
  const transport = jest.fn<Promise<Response>, [string, RequestInit]>();

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminGeocodeService,
        StoreSellerRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'kakaoLocal' ? { restApiKey } : undefined,
          },
        },
        { provide: KAKAO_LOCAL_TRANSPORT, useValue: transport },
      ],
    });
    service = module.get(AdminGeocodeService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    restApiKey = 'rest-key';
    transport.mockReset();
  });

  async function admin(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }

  async function district(slug: string, overrides = {}) {
    const group = await createRegion(prisma, { level: 1 });
    return createRegion(prisma, {
      level: 2,
      parent_id: group.id,
      slug,
      ...overrides,
    });
  }

  describe('adminGeocodeAddress', () => {
    it('첫 결과를 도로명·지번·행정구역·시군구코드로 매핑하고 좌표는 소수 7자리로 반올림한다', async () => {
      const region = await district('sgg-11680');
      transport.mockResolvedValue(kakaoResponse([ROAD_DOCUMENT]));

      const result = await service.adminGeocodeAddress(
        await admin(),
        '  테헤란로 152 ',
      );

      expect(result).toEqual({
        latitude: 37.5000242,
        longitude: 127.0365086,
        roadAddress: '서울 강남구 테헤란로 152',
        jibunAddress: '서울 강남구 역삼동 737',
        sido: '서울',
        sigungu: '강남구',
        bname: '역삼동',
        sigunguCode: '11680',
        regionId: region.id.toString(),
      });
      const [url, init] = transport.mock.calls[0];
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe(
        'https://dapi.kakao.com/v2/local/search/address.json',
      );
      expect(parsed.searchParams.get('query')).toBe('테헤란로 152');
      expect(init.headers).toEqual({ Authorization: 'KakaoAK rest-key' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    // 이진 부동소수 곱셈(Math.round(v*1e7))·toFixed는 앞 두 줄에서 한 자리씩 틀린다
    it.each([
      ['37.00000065', '127.00000005', 37.0000007, 127.0000001],
      ['37.56667785', '126.97800005', 37.5666779, 126.9780001],
      ['37.5', '127', 37.5, 127],
    ])(
      '좌표 y=%s x=%s는 십진 반올림으로 %d, %d',
      async (y, x, latitude, longitude) => {
        transport.mockResolvedValue(
          kakaoResponse([{ ...ROAD_DOCUMENT, x, y }]),
        );
        await expect(
          service.adminGeocodeAddress(await admin(), '주소'),
        ).resolves.toMatchObject({ latitude, longitude });
      },
    );

    it('지번만 있는 결과는 도로명이 null이고 빈 문자열 필드도 null로 내린다', async () => {
      transport.mockResolvedValue(
        kakaoResponse([
          {
            ...ROAD_DOCUMENT,
            road_address: null,
            address: { ...ROAD_DOCUMENT.address, region_3depth_name: '' },
          },
        ]),
      );
      const result = await service.adminGeocodeAddress(await admin(), '역삼동');
      expect(result).toMatchObject({
        roadAddress: null,
        jibunAddress: '서울 강남구 역삼동 737',
        bname: null,
        sigunguCode: '11680',
      });
    });

    it.each([
      ['매칭 지역 없음', 'sgg-11110', {}],
      ['비활성 지역', 'sgg-11680', { is_active: false }],
      ['1단계 지역', 'sgg-11680', { level: 1, parent_id: null }],
    ])(
      '%s이면 regionId는 null이고 sigunguCode는 남는다',
      async (_label, slug, overrides) => {
        await district(slug, overrides);
        transport.mockResolvedValue(kakaoResponse([ROAD_DOCUMENT]));
        await expect(
          service.adminGeocodeAddress(await admin(), '테헤란로 152'),
        ).resolves.toMatchObject({ sigunguCode: '11680', regionId: null });
      },
    );

    it('법정동 코드가 없으면 행정동 코드로, 둘 다 없으면 sigunguCode·regionId가 null이다', async () => {
      await district('sgg-11680');
      transport.mockResolvedValueOnce(
        kakaoResponse([
          {
            ...ROAD_DOCUMENT,
            address: { ...ROAD_DOCUMENT.address, b_code: '' },
          },
        ]),
      );
      transport.mockResolvedValueOnce(
        kakaoResponse([{ ...ROAD_DOCUMENT, address: null }]),
      );
      const id = await admin();

      await expect(
        service.adminGeocodeAddress(id, '테헤란로 152'),
      ).resolves.toMatchObject({ sigunguCode: '11680' });
      await expect(
        service.adminGeocodeAddress(id, '테헤란로 152'),
      ).resolves.toMatchObject({
        sigunguCode: null,
        regionId: null,
        jibunAddress: null,
        sido: '서울',
      });
    });

    it('결과가 0건이면 null', async () => {
      transport.mockResolvedValue(kakaoResponse([]));
      await expect(
        service.adminGeocodeAddress(await admin(), '없는 주소'),
      ).resolves.toBeNull();
    });

    it.each<[string, () => void]>([
      [
        '카카오맵 비활성 403',
        () =>
          transport.mockResolvedValue(
            new Response(
              JSON.stringify({
                errorType: 'NotAuthorizedError',
                message: 'App(케이퀵) disabled OPEN_MAP_AND_LOCAL service.',
              }),
              { status: 403 },
            ),
          ),
      ],
      [
        '잘못된 키 401',
        () => transport.mockResolvedValue(kakaoResponse([], 401)),
      ],
      [
        '카카오 5xx',
        () => transport.mockResolvedValue(new Response('', { status: 502 })),
      ],
      ['타임아웃', () => transport.mockRejectedValue(timeoutError())],
      [
        '네트워크 오류',
        () => transport.mockRejectedValue(new TypeError('fetch failed')),
      ],
      [
        '본문이 JSON이 아님',
        () => transport.mockResolvedValue(new Response('<html>')),
      ],
      [
        'documents 배열 없음',
        () => transport.mockResolvedValue(new Response('{"meta":{}}')),
      ],
      [
        '좌표가 숫자가 아님',
        () =>
          transport.mockResolvedValue(
            kakaoResponse([{ ...ROAD_DOCUMENT, y: 'abc' }]),
          ),
      ],
      [
        '위도 범위 밖',
        () =>
          transport.mockResolvedValue(
            kakaoResponse([{ ...ROAD_DOCUMENT, y: '91' }]),
          ),
      ],
      [
        'REST API 키 미설정',
        () => {
          restApiKey = undefined;
          transport.mockResolvedValue(kakaoResponse([ROAD_DOCUMENT]));
        },
      ],
    ])('%s → GEOCODE_UNAVAILABLE(503)', async (_label, arrange) => {
      arrange();
      await expect(
        service.adminGeocodeAddress(await admin(), '테헤란로 152'),
      ).rejects.toThrowDomain('GEOCODE_UNAVAILABLE');
    });

    it('키가 없으면 카카오를 호출하지 않는다', async () => {
      restApiKey = undefined;
      await expect(
        service.adminGeocodeAddress(await admin(), '테헤란로 152'),
      ).rejects.toThrowDomain(503);
      expect(transport).not.toHaveBeenCalled();
    });

    it('요청 신호는 제한 시간이 지나면 끊긴다', async () => {
      transport.mockResolvedValue(kakaoResponse([]));
      await service.adminGeocodeAddress(await admin(), '테헤란로 152');
      const { signal } = transport.mock.calls[0][1];
      expect(signal?.aborted).toBe(false);
      await new Promise((resolve) =>
        setTimeout(resolve, GEOCODE_TIMEOUT_MS + 100),
      );
      expect(signal?.aborted).toBe(true);
    });

    it.each([
      ['빈 문자열', '', 'TEXT_REQUIRED'],
      ['공백만', '   ', 'TEXT_REQUIRED'],
      ['201자', '가'.repeat(201), 'TEXT_TOO_LONG'],
    ] as const)(
      'query가 %s이면 %s이고 카카오를 호출하지 않는다',
      async (_label, query, code) => {
        await expect(
          service.adminGeocodeAddress(await admin(), query),
        ).rejects.toThrowDomain(code);
        expect(transport).not.toHaveBeenCalled();
      },
    );

    it('앞뒤 공백을 뺀 200자는 통과한다', async () => {
      transport.mockResolvedValue(kakaoResponse([]));
      await expect(
        service.adminGeocodeAddress(await admin(), ` ${'가'.repeat(200)} `),
      ).resolves.toBeNull();
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it('관리자가 아니면 ADMIN_ONLY이고 카카오를 호출하지 않는다', async () => {
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      await expect(
        service.adminGeocodeAddress(seller.id, '테헤란로 152'),
      ).rejects.toThrowDomain('ADMIN_ONLY');
      expect(transport).not.toHaveBeenCalled();
    });
  });
});
