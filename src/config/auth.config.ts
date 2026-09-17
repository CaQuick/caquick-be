import { registerAs } from '@nestjs/config';

export interface AuthConfig {
  jwtSecret: string;
  jwtAccessExpiresSeconds: number;
  refreshExpiresInDays: number;
  cookieDomain?: string;
  cookieSecure: boolean;
  frontendBaseUrl: string;
  backendBaseUrl: string;
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

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
 * JWT 시크릿 — JWT_ACCESS_SECRET 우선, 없으면 JWT_SECRET.
 * 공백만 있는 값은 미설정으로 본다(strategy·module이 이 값을 그대로 서명키로 쓴다).
 */
function readJwtSecret(): string | undefined {
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_SECRET'] as const) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export default registerAs('auth', (): AuthConfig => {
  const isProd = process.env.NODE_ENV === 'production';
  const jwtSecret = readJwtSecret();

  if (isProd && !jwtSecret) {
    throw new Error(
      'JWT_SECRET or JWT_ACCESS_SECRET must be set in production environment',
    );
  }

  return {
    jwtSecret: jwtSecret ?? 'dev_jwt_secret',
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
