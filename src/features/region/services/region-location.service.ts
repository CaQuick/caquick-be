import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { DomainException } from '@/common/errors/error-catalog';
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
/** 소수 3자리(약 100m) 격자로 카카오 결과(시군구 코드)를 캐시한다. 지역 활성 여부는 매번 DB에서 본다. */
const CACHE_PRECISION = 3;
export const LOCATION_CACHE_TTL_SECONDS = 24 * 60 * 60;
const NO_DISTRICT = '-';

interface KakaoRegionDocument {
  region_type?: unknown;
  code?: unknown;
}

export function locationCacheKey(latitude: number, longitude: number): string {
  return `region:loc:${latitude.toFixed(CACHE_PRECISION)}:${longitude.toFixed(CACHE_PRECISION)}`;
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
 * 현재 위치 → 2차 지역. 좌표는 카카오 요청에만 쓰고 저장·로그하지 않는다(캐시 키는 약 100m 격자이고 이용자와 묶이지 않는다).
 * 이용 사실은 위치정보법 확인자료로 남긴다.
 */
@Injectable()
export class RegionLocationService {
  private readonly logger = new Logger(RegionLocationService.name);

  constructor(
    private readonly repo: RegionRepository,
    private readonly accessLogs: LocationAccessLogService,
    private readonly config: ConfigService,
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
    const key = locationCacheKey(input.latitude, input.longitude);
    const cached = await this.redis.get(key).catch((error: unknown) => {
      this.logger.warn(`위치 캐시 조회 실패: ${String(error)}`);
      return null;
    });
    if (cached !== null) return cached === NO_DISTRICT ? null : cached;

    const code = await this.fetchSigunguCode(input);
    await this.redis
      .set(key, code ?? NO_DISTRICT, 'EX', LOCATION_CACHE_TTL_SECONDS)
      .catch((error: unknown) =>
        this.logger.warn(`위치 캐시 저장 실패: ${String(error)}`),
      );
    return code;
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
