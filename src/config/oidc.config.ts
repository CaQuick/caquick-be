import { registerAs } from '@nestjs/config';

/**
 * OIDC Provider 설정 타입
 */
export interface OidcProviderConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
}

/**
 * OIDC 설정 타입
 */
export interface OidcConfig {
  google: OidcProviderConfig;
  kakao: OidcProviderConfig;
}

/**
 * 필수 환경변수 검증 및 반환 (config 초기화 시 사용)
 *
 * registerAs 내부에서는 ConfigService를 사용할 수 없으므로
 * process.env를 직접 접근합니다.
 */
function mustGetEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

/**
 * OIDC 설정
 */
export default registerAs('oidc', (): OidcConfig => {
  return {
    google: {
      issuerUrl: mustGetEnv('OIDC_GOOGLE_ISSUER_URL'),
      clientId: mustGetEnv('OIDC_GOOGLE_CLIENT_ID'),
      clientSecret: mustGetEnv('OIDC_GOOGLE_CLIENT_SECRET'),
    },
    kakao: {
      issuerUrl: mustGetEnv('OIDC_KAKAO_ISSUER_URL'),
      clientId: mustGetEnv('OIDC_KAKAO_CLIENT_ID'),
      clientSecret: mustGetEnv('OIDC_KAKAO_CLIENT_SECRET'),
    },
  };
});
