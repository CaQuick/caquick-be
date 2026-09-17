import { PrismaMariaDb } from '@prisma/adapter-mariadb';

export interface MariaDbAdapterOptions {
  allowPublicKeyRetrieval?: boolean;
}

/**
 * DATABASE_URL을 그대로 풀에 넘긴다 — URL 쿼리의 드라이버 옵션(ssl·connectionLimit·타임아웃 등)이
 * 보존되도록 파싱해 재조립하지 않는다. mariadb 드라이버는 caching_sha2_password 계정의 첫 연결
 * (비TLS·콜드 캐시)에서 RSA 공개키 조회를 기본 차단하므로, 그 환경(테스트 컨테이너 root)만
 * allowPublicKeyRetrieval을 URL 옵션으로 덧붙인다.
 */
export function withAdapterOptions(
  databaseUrl: string,
  options: MariaDbAdapterOptions = {},
): string {
  if (!options.allowPublicKeyRetrieval) return databaseUrl;
  const url = new URL(databaseUrl);
  url.searchParams.set('allowPublicKeyRetrieval', 'true');
  return url.toString();
}

export function createMariaDbAdapter(
  databaseUrl: string,
  options: MariaDbAdapterOptions = {},
): PrismaMariaDb {
  return new PrismaMariaDb(withAdapterOptions(databaseUrl, options));
}
