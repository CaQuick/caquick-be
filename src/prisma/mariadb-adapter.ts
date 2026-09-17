import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * DATABASE_URL(mysql://user:pass@host:port/db)을 mariadb 풀 설정으로 풀어 어댑터를 만든다.
 * mariadb 드라이버는 caching_sha2_password 계정의 첫 연결(비TLS·콜드 캐시)에서 RSA 공개키 조회를
 * 기본 차단하므로, 그 환경(테스트 컨테이너 root)만 allowPublicKeyRetrieval을 켠다
 * (옵션 또는 URL 쿼리 `?allowPublicKeyRetrieval=true`).
 */
export function createMariaDbAdapter(
  databaseUrl: string,
  options: { allowPublicKeyRetrieval?: boolean } = {},
): PrismaMariaDb {
  const url = new URL(databaseUrl);
  return new PrismaMariaDb({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    allowPublicKeyRetrieval:
      options.allowPublicKeyRetrieval ??
      url.searchParams.get('allowPublicKeyRetrieval') === 'true',
  });
}
