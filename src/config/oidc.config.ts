import { registerAs } from '@nestjs/config';

export interface OidcProviderConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface OidcConfig {
  google: OidcProviderConfig;
  kakao: OidcProviderConfig;
}

function mustGetProcessEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

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
