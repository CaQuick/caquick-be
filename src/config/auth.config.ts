import { registerAs } from '@nestjs/config';

/**
 * 인증 설정 타입
 */
export interface AuthConfig {
  jwtSecret: string;
  jwtAccessExpiresSeconds: number;
  refreshExpiresInDays: number;
  cookieDomain?: string;
  cookieSecure: boolean;
  frontendBaseUrl: string;
  backendBaseUrl: string;
}

/**
 * 환경변수를 숫자로 파싱 (실패 시 기본값 반환)
 */
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

/**
 * 환경변수를 불리언으로 파싱
 */
function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (!value) return defaultValue;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return defaultValue;
}

/**
 * 후보 중 공백이 아닌 첫 값을 trim해 반환 (없으면 빈 문자열)
 */
function firstNonBlank(...values: (string | undefined)[]): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/**
 * 인증 설정
 */
export default registerAs('auth', (): AuthConfig => {
  const isProd = process.env.NODE_ENV === 'production';

  // JWT_ACCESS_SECRET을 정본으로 두되 JWT_SECRET도 받는다. 이 해석값이 유일한
  // 소비 경로이므로(→ resolveAccessTokenSecret) 둘 중 뭘 설정했든 동작이 같다.
  // 빈 문자열은 미설정으로 본다 — compose/CI가 미정의 변수를 ''로 주입하는 경우가
  // 흔해서, ??로 받으면 폴백이 건너뛰어진다.
  const jwtSecret = firstNonBlank(
    process.env.JWT_ACCESS_SECRET,
    process.env.JWT_SECRET,
  );

  // 환경 불문 fail-fast. 예전엔 여기서 dev 기본값('dev_jwt_secret')을 흘려보냈지만
  // 실제 소비처가 raw JWT_ACCESS_SECRET을 다시 요구해 어차피 부팅이 막혔다 — 죽은
  // 폴백이었다. NODE_ENV 오설정 시 알려진 시크릿으로 조용히 뜨는 쪽이 더 위험하다.
  if (!jwtSecret) {
    throw new Error(
      'JWT_SECRET or JWT_ACCESS_SECRET must be set (checked in every environment)',
    );
  }

  return {
    jwtSecret,
    jwtAccessExpiresSeconds: parseNumber(
      process.env.JWT_ACCESS_EXPIRES_SECONDS,
      900,
    ), // 15분
    refreshExpiresInDays: parseNumber(
      process.env.AUTH_REFRESH_EXPIRES_DAYS,
      30,
    ), // 30일
    cookieDomain: process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined,
    cookieSecure: parseBoolean(process.env.AUTH_COOKIE_SECURE, isProd),
    frontendBaseUrl:
      process.env.FRONTEND_BASE_URL?.trim() || 'http://localhost:3000',
    backendBaseUrl:
      process.env.BACKEND_BASE_URL?.trim() || 'http://localhost:4000',
  };
});
