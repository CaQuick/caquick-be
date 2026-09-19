import { registerAs } from '@nestjs/config';

import {
  parseEnvBoolean,
  parseEnvList,
  parseEnvNumber,
  parseEnvString,
} from '@/common/utils/env-parse';

export interface AuthConfig {
  jwtSecret: string;
  jwtAccessExpiresSeconds: number;
  refreshExpiresInDays: number;
  cookieDomain?: string;
  cookieSecure: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
  /** 리다이렉트 기본값(단일 값). */
  frontendBaseUrl: string;
  /** CORS 허용 오리진 목록 — FRONTEND_BASE_URL에 쉼표로 여러 개를 적을 수 있다. 미설정이면 빈 배열. */
  frontendOrigins: string[];
  backendBaseUrl: string;
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

/** 알 수 없는 값은 가장 보수적인 기본값(lax)으로. */
function parseSameSite(
  value: string | undefined,
): AuthConfig['cookieSameSite'] {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'none' ||
    normalized === 'strict' ||
    normalized === 'lax'
    ? normalized
    : 'lax';
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
    jwtAccessExpiresSeconds: parseEnvNumber(
      process.env.JWT_ACCESS_EXPIRES_SECONDS,
      900,
    ), // 15분
    refreshExpiresInDays: parseEnvNumber(
      process.env.AUTH_REFRESH_EXPIRES_DAYS,
      30,
    ), // 30일
    cookieDomain: parseEnvString(process.env.AUTH_COOKIE_DOMAIN),
    cookieSecure: parseEnvBoolean(process.env.AUTH_COOKIE_SECURE, isProd),
    cookieSameSite: parseSameSite(process.env.AUTH_COOKIE_SAMESITE),
    frontendBaseUrl:
      parseEnvString(process.env.FRONTEND_BASE_URL) ?? 'http://localhost:3000',
    frontendOrigins: parseEnvList(process.env.FRONTEND_BASE_URL),
    backendBaseUrl:
      parseEnvString(process.env.BACKEND_BASE_URL) ?? 'http://localhost:4000',
  };
});
