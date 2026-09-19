import type { ConfigService } from '@nestjs/config';

import type { AuthConfig } from '@/config/auth.config';
import type { CookieSameSite } from '@/features/auth/helpers/auth-cookie.helper';

/**
 * Token/OIDC/Logout이 같은 쿠키 옵션을 쓰므로 한곳에 모은다.
 * 값 자체는 authConfig가 단일 소스 — 여기서 raw env를 다시 파싱하지 않는다(P1-11a).
 */
export class AuthCookieOptions {
  private static auth(config: ConfigService): AuthConfig {
    return config.getOrThrow<AuthConfig>('auth');
  }

  static getCookieDomain(config: ConfigService): string | undefined {
    return this.auth(config).cookieDomain;
  }

  static isCookieSecure(config: ConfigService): boolean {
    return this.auth(config).cookieSecure;
  }

  static getCookieSameSite(config: ConfigService): CookieSameSite {
    return this.auth(config).cookieSameSite;
  }
}
