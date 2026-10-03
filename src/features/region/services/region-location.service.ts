import { createHmac, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import { districtSlugOf, sigunguCodeOf } from '@/common/utils/legal-dong-code';
import type { KakaoLocalConfig } from '@/config/kakao-local.config';
import type { RegionByLocationInput } from '@/features/region/dto/inputs/region-by-location.input';
import { RegionRepository } from '@/features/region/repositories/region.repository';
import { LocationAccessLogService } from '@/features/region/services/location-access-log.service';
import { toRegionByLocationOutput } from '@/features/region/services/region-mappers.helper';
import type { RegionByLocationOutput } from '@/features/region/types/region-output.type';
import {
  KAKAO_LOCAL_TRANSPORT,
  type KakaoLocalTransport,
} from '@/global/kakao-local';
import { REDIS_CLIENT } from '@/global/redis';

const KAKAO_COORD_TO_REGION_URL =
  'https://dapi.kakao.com/v2/local/geo/coord2regioncode.json';
export const LOCATION_LOOKUP_TIMEOUT_MS = 3_000;
/** 국내(마라도·독도·백령도 포함) 밖이면 서비스 지역일 수 없어 카카오에 묻지 않는다. */
const KOREA_BOUNDS = { minLat: 33, maxLat: 39, minLng: 124, maxLng: 132 };
/**
 * 소수 5자리(약 1m) 격자로 카카오 결과(시군구 코드)를 캐시한다 — 격자가 구 경계를 걸쳐도 오차가 측위 오차보다 작다.
 * 지역 활성 여부는 매번 DB에서 본다.
 */
const CACHE_PRECISION = 5;
/** 캐시는 매일 04:00 KST(19:00 UTC)에 일괄 만료한다 — 요청마다 TTL을 주면 남은 TTL로 요청 시각이 드러난다. */
const CACHE_EXPIRES_AT_UTC_HOUR = 19;
const NO_DISTRICT = '-';

export function nextCacheExpiry(now: Date): Date {
  const at = new Date(now);
  at.setUTCHours(CACHE_EXPIRES_AT_UTC_HOUR, 0, 0, 0);
  if (at <= now) at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

interface KakaoRegionDocument {
  region_type?: unknown;
  code?: unknown;
}

function inKorea({ latitude, longitude }: RegionByLocationInput): boolean {
  return (
    latitude >= KOREA_BOUNDS.minLat &&
    latitude <= KOREA_BOUNDS.maxLat &&
    longitude >= KOREA_BOUNDS.minLng &&
    longitude <= KOREA_BOUNDS.maxLng
  );
}

function parseDocuments(body: string): KakaoRegionDocument[] | null {
  try {
    const documents = (JSON.parse(body) as { documents?: unknown })?.documents;
    if (!Array.isArray(documents)) return null;
    return documents.every((d) => typeof d === 'object' && d !== null)
      ? (documents as KakaoRegionDocument[])
      : null;
  } catch {
    return null;
  }
}

/** 법정동(B)을 우선하고 없으면 행정동(H)으로 본다. */
function sigunguCodeFrom(documents: KakaoRegionDocument[]): string | null {
  const codeOf = (type: string) =>
    sigunguCodeOf(documents.find((d) => d.region_type === type)?.code);
  return codeOf('B') ?? codeOf('H');
}

/**
 * 현재 위치 → 2차 지역. 좌표는 카카오 요청에만 쓰고 저장·로그하지 않는다. 이용 사실은 위치정보법 확인자료로 남긴다.
 * 캐시 키는 격자 좌표의 HMAC이고 비밀값은 기동마다 새로 뽑아 메모리에만 둔다 — Redis만으로는 위치를 되돌릴 수 없다.
 */
@Injectable()
export class RegionLocationService {
  private readonly logger = new Logger(RegionLocationService.name);
  private readonly cacheSecret = randomBytes(32);

  constructor(
    private readonly repo: RegionRepository,
    private readonly accessLogs: LocationAccessLogService,
    private readonly config: ConfigService,
    private readonly clock: ClockService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(KAKAO_LOCAL_TRANSPORT)
    private readonly transport: KakaoLocalTransport,
  ) {}

  async regionByLocation(
    input: RegionByLocationInput,
    accountId: bigint | null,
  ): Promise<RegionByLocationOutput | null> {
    await this.accessLogs.record(accountId, 'REGION_BY_LOCATION');
    if (!inKorea(input)) return null;

    const sigunguCode = await this.sigunguCodeAt(input);
    if (!sigunguCode) return null;
    const row = await this.repo.findSelectableDistrictBySlug(
      districtSlugOf(sigunguCode),
    );
    return row ? toRegionByLocationOutput(row) : null;
  }

  private async sigunguCodeAt(
    input: RegionByLocationInput,
  ): Promise<string | null> {
    const key = this.cacheKey(input);
    const cached = await this.redis.get(key).catch((error: unknown) => {
      this.logger.warn(`위치 캐시 조회 실패: ${String(error)}`);
      return null;
    });
    if (cached !== null) return cached === NO_DISTRICT ? null : cached;

    const code = await this.fetchSigunguCode(input);
    await this.redis
      .set(
        key,
        code ?? NO_DISTRICT,
        'PXAT',
        nextCacheExpiry(this.clock.now()).getTime(),
      )
      .catch((error: unknown) =>
        this.logger.warn(`위치 캐시 저장 실패: ${String(error)}`),
      );
    return code;
  }

  private cacheKey({ latitude, longitude }: RegionByLocationInput): string {
    const cell = `${latitude.toFixed(CACHE_PRECISION)}:${longitude.toFixed(CACHE_PRECISION)}`;
    return `region:loc:${createHmac('sha256', this.cacheSecret).update(cell).digest('base64url')}`;
  }

  private async fetchSigunguCode({
    latitude,
    longitude,
  }: RegionByLocationInput): Promise<string | null> {
    const apiKey = this.config.get<KakaoLocalConfig>('kakaoLocal')?.restApiKey;
    if (!apiKey)
      return this.unavailable('REST API 키(OIDC_KAKAO_CLIENT_ID) 미설정');

    const query = new URLSearchParams({
      x: String(longitude),
      y: String(latitude),
    });
    let status: number;
    let body: string;
    try {
      const response = await this.transport(
        `${KAKAO_COORD_TO_REGION_URL}?${query.toString()}`,
        {
          headers: { Authorization: `KakaoAK ${apiKey}` },
          signal: AbortSignal.timeout(LOCATION_LOOKUP_TIMEOUT_MS),
        },
      );
      status = response.status;
      body = await response.text();
    } catch (error) {
      return this.unavailable(
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
      );
    }
    // 응답 본문은 남기지 않는다 — 요청 좌표가 되돌아올 수 있다
    if (status !== 200) return this.unavailable(`HTTP ${status}`);
    const documents = parseDocuments(body);
    if (!documents) return this.unavailable('응답 형식 불일치');
    return sigunguCodeFrom(documents);
  }

  private unavailable(cause: string): never {
    this.logger.warn(`현재 위치 → 지역 변환 실패: ${cause}`);
    throw new DomainException('LOCATION_LOOKUP_UNAVAILABLE');
  }
}
