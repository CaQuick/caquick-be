import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainException } from '@/common/errors/error-catalog';
import {
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  type DecimalRange,
} from '@/common/utils/decimal-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import type { KakaoLocalConfig } from '@/config/kakao-local.config';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import {
  KAKAO_LOCAL_TRANSPORT,
  type KakaoLocalTransport,
} from '@/features/store/adapters/kakao-local.transport';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { AdminGeocodeResultOutput } from '@/features/store/types/store-admin-geocode-output.type';
import { Prisma } from '@/generated/prisma/client';

const KAKAO_ADDRESS_SEARCH_URL =
  'https://dapi.kakao.com/v2/local/search/address.json';
export const GEOCODE_TIMEOUT_MS = 3_000;
export const GEOCODE_QUERY_MAX_LENGTH = 200;
/** 매장·지역 좌표 컬럼이 DECIMAL(10,7)이라 그대로 저장되는 정밀도로 맞춘다. */
const COORDINATE_SCALE = 7;
const LOGGED_BODY_LIMIT = 300;

interface KakaoAddress {
  address_name?: string;
  region_1depth_name?: string;
  region_2depth_name?: string;
  region_3depth_name?: string;
  b_code?: string;
  h_code?: string;
}

interface KakaoAddressDocument {
  x?: unknown;
  y?: unknown;
  address?: KakaoAddress | null;
  road_address?: KakaoAddress | null;
}

function textOrNull(value: string | undefined): string | null {
  return value?.trim() || null;
}

/** 이진 부동소수 곱셈 반올림은 경계값에서 한 자리씩 틀리므로 십진 연산으로 자른다. */
function toCoordinate(raw: unknown, range: DecimalRange): number | null {
  if (typeof raw !== 'string') return null;
  try {
    const value = new Prisma.Decimal(raw);
    if (!value.isFinite() || value.lt(range.min) || value.gt(range.max)) {
      return null;
    }
    return value.toDecimalPlaces(COORDINATE_SCALE).toNumber();
  } catch {
    return null;
  }
}

/** 법정동 코드(10자리)의 앞 5자리가 시군구 코드 — 지역 slug 'sgg-<시군구코드>'와 같은 체계다. */
function toSigunguCode(
  address: KakaoAddress | null | undefined,
): string | null {
  const code = address?.b_code || address?.h_code;
  return code && /^\d{10}$/.test(code) ? code.slice(0, 5) : null;
}

function parseDocuments(body: string): KakaoAddressDocument[] | null {
  try {
    const documents = (JSON.parse(body) as { documents?: unknown })?.documents;
    return Array.isArray(documents)
      ? (documents as KakaoAddressDocument[])
      : null;
  } catch {
    return null;
  }
}

/** 판매자 등록·매장 수정·지역 중심 좌표 입력을 돕는 주소 → 좌표 프록시. 키는 서버에만 둔다. */
@Injectable()
export class AdminGeocodeService extends AdminBaseService {
  private readonly logger = new Logger(AdminGeocodeService.name);

  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly stores: StoreSellerRepository,
    private readonly config: ConfigService,
    @Inject(KAKAO_LOCAL_TRANSPORT)
    private readonly transport: KakaoLocalTransport,
  ) {
    super(accounts, auditLogs);
  }

  async adminGeocodeAddress(
    accountId: bigint,
    rawQuery: string,
  ): Promise<AdminGeocodeResultOutput | null> {
    await this.requireAdminContext(accountId);
    const query = cleanRequiredText(rawQuery, GEOCODE_QUERY_MAX_LENGTH);
    const document = await this.searchFirstAddress(query);
    if (!document) return null;

    const latitude = toCoordinate(document.y, LATITUDE_RANGE);
    const longitude = toCoordinate(document.x, LONGITUDE_RANGE);
    if (latitude === null || longitude === null) {
      return this.unavailable(
        `좌표 형식 불일치 x=${String(document.x)} y=${String(document.y)}`,
      );
    }
    const { address, road_address: road } = document;
    const sigunguCode = toSigunguCode(address);
    const regionId = sigunguCode
      ? await this.stores.findSelectableRegionIdBySlug(`sgg-${sigunguCode}`)
      : null;
    return {
      latitude,
      longitude,
      roadAddress: textOrNull(road?.address_name),
      jibunAddress: textOrNull(address?.address_name),
      sido: textOrNull(address?.region_1depth_name ?? road?.region_1depth_name),
      sigungu: textOrNull(
        address?.region_2depth_name ?? road?.region_2depth_name,
      ),
      bname: textOrNull(
        address?.region_3depth_name ?? road?.region_3depth_name,
      ),
      sigunguCode,
      regionId: regionId?.toString() ?? null,
    };
  }

  private async searchFirstAddress(
    query: string,
  ): Promise<KakaoAddressDocument | null> {
    const apiKey = this.config.get<KakaoLocalConfig>('kakaoLocal')?.restApiKey;
    if (!apiKey)
      return this.unavailable('REST API 키(OIDC_KAKAO_CLIENT_ID) 미설정');

    const url = `${KAKAO_ADDRESS_SEARCH_URL}?${new URLSearchParams({ query, size: '1' }).toString()}`;
    let status: number;
    let body: string;
    try {
      const response = await this.transport(url, {
        headers: { Authorization: `KakaoAK ${apiKey}` },
        signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
      });
      status = response.status;
      body = await response.text();
    } catch (error) {
      return this.unavailable(
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
      );
    }
    if (status !== 200) {
      return this.unavailable(
        `HTTP ${status} ${body.slice(0, LOGGED_BODY_LIMIT)}`,
      );
    }
    const documents = parseDocuments(body);
    if (!documents) {
      return this.unavailable(
        `응답 형식 불일치 ${body.slice(0, LOGGED_BODY_LIMIT)}`,
      );
    }
    return documents[0] ?? null;
  }

  private unavailable(cause: string): never {
    this.logger.warn(`카카오 주소 좌표 변환 실패 — ${cause}`);
    throw new DomainException('GEOCODE_UNAVAILABLE');
  }
}
