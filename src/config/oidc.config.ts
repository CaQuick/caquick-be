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
 */
function mustGetProcessEnv(key: string): string {
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
      issuerUrl: mustGetProcessEnv('OIDC_GOOGLE_ISSUER_URL'),
      clientId: mustGetProcessEnv('OIDC_GOOGLE_CLIENT_ID'),
      clientSecret: mustGetProcessEnv('OIDC_GOOGLE_CLIENT_SECRET'),
    },
    kakao: {
      issuerUrl: mustGetProcessEnv('OIDC_KAKAO_ISSUER_URL'),
      clientId: mustGetProcessEnv('OIDC_KAKAO_CLIENT_ID'),
      clientSecret: mustGetProcessEnv('OIDC_KAKAO_CLIENT_SECRET'),
    },
  };
});
