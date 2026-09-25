import { registerAs } from '@nestjs/config';

import {
  parseEnvBoolean,
  parseEnvList,
  parseEnvNumber,
  parseEnvString,
} from '@/common/utils/env-parse';
import {
  buildKeyMaterial,
  generateEphemeralKeyMaterial,
  type JwtKeyMaterial,
  readPem,
} from '@/config/jwt-key';

export interface AuthConfig {
  /** RS256 서명/검증 키 + JWKS 공개용 JWK. kid는 RFC 7638 썸프린트다. */
  jwtKeys: JwtKeyMaterial;
  jwtIssuer: string;
  jwtAudience: string;
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
 * 서명 키 — base64 PEM(JWT_PRIVATE_KEY_PEM_B64) 또는 파일 경로(JWT_PRIVATE_KEY_PATH).
 * 공개키는 생략하면 개인키에서 유도한다. 미설정이면 운영에서 부팅을 막고, 그 외에는 임시 키를 만든다.
 */
function readJwtKeys(isProd: boolean): JwtKeyMaterial {
  const privateKeyPem = readPem({
    base64: process.env.JWT_PRIVATE_KEY_PEM_B64,
    path: process.env.JWT_PRIVATE_KEY_PATH,
  });
  if (!privateKeyPem) {
    if (isProd) {
      throw new Error(
        'JWT_PRIVATE_KEY_PEM_B64 or JWT_PRIVATE_KEY_PATH must be set in production environment',
      );
    }
    return generateEphemeralKeyMaterial();
  }
  return buildKeyMaterial({
    privateKeyPem,
    publicKeyPem: readPem({
      base64: process.env.JWT_PUBLIC_KEY_PEM_B64,
      path: process.env.JWT_PUBLIC_KEY_PATH,
    }),
  });
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

  return {
    jwtKeys: readJwtKeys(isProd),
    jwtIssuer: parseEnvString(process.env.JWT_ISSUER) ?? 'caquick-identity',
    jwtAudience: parseEnvString(process.env.JWT_AUDIENCE) ?? 'caquick-api',
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
