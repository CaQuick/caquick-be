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
 * 인증 설정
 */
export default registerAs('auth', (): AuthConfig => {
  const isProd = process.env.NODE_ENV === 'production';
  const jwtSecret =
    process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET ?? '';

  if (isProd && !jwtSecret) {
    throw new Error(
      'JWT_SECRET or JWT_ACCESS_SECRET must be set in production environment',
    );
  }

  return {
    jwtSecret: jwtSecret || 'dev_jwt_secret',
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
