import type { AuthConfig } from '@/config/auth.config';
import { generateEphemeralKeyMaterial } from '@/config/jwt-key';

/** jest 워커당 1벌만 만든다(RSA 생성 비용). */
const TEST_JWT_KEYS = generateEphemeralKeyMaterial();

/**
 * spec용 authConfig 기본값 — 실제 `registerAs('auth')`가 env 없이 만들어 내는 값과 같다.
 * 소비처가 raw env 대신 이 네임스페이스만 읽으므로, ConfigService mock은 이 값을 돌려주면 된다.
 */
export const TEST_AUTH_CONFIG: AuthConfig = {
  jwtKeys: TEST_JWT_KEYS,
  jwtIssuer: 'caquick-identity',
  jwtAudience: 'caquick-api',
  jwtAccessExpiresSeconds: 900,
  refreshExpiresInDays: 30,
  cookieDomain: undefined,
  cookieSecure: false,
  cookieSameSite: 'lax',
  frontendBaseUrl: 'http://localhost:3000',
  frontendOrigins: [],
  backendBaseUrl: 'http://localhost:4000',
};

export function testAuthConfig(
  overrides: Partial<AuthConfig> = {},
): AuthConfig {
  return { ...TEST_AUTH_CONFIG, ...overrides };
}
