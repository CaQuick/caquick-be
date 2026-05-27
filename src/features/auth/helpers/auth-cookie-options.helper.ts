import type { ConfigService } from '@nestjs/config';

import { getEnvAsBoolean } from '@/common/helpers/config.helper';
import type { CookieSameSite } from '@/features/auth/helpers/auth-cookie.helper';

/**
 * Auth 쿠키 옵션 (domain / secure / sameSite) 을 ConfigService 에서 읽어주는 헬퍼.
 *
 * Token / OIDC / Logout 등 여러 서비스가 동일 옵션을 사용하므로 한곳에 모은다.
 * 자체 DI 금지 (CLAUDE.md common/helpers 규칙과 동일 패턴).
 */
export class AuthCookieOptions {
  /**
   * 쿠키 도메인을 반환한다.
   */
  static getCookieDomain(config: ConfigService): string | undefined {
    const v = config.get<string>('AUTH_COOKIE_DOMAIN');
    const trimmed = v?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  }

  /**
   * 쿠키 secure 옵션을 반환한다.
   *
   * 기본값: NODE_ENV === 'production' 이면 true.
   */
  static isCookieSecure(config: ConfigService): boolean {
    const envValue = config.get<string>('AUTH_COOKIE_SECURE');
    if (envValue !== undefined) {
      return getEnvAsBoolean(config, 'AUTH_COOKIE_SECURE', false);
    }
    return (config.get<string>('NODE_ENV') ?? '') === 'production';
  }

  /**
   * 쿠키 sameSite 옵션을 반환한다.
   * AUTH_COOKIE_SAMESITE (lax | strict | none) 으로 override 가능. 기본값 'lax'.
   */
  static getCookieSameSite(config: ConfigService): CookieSameSite {
    const v = config.get<string>('AUTH_COOKIE_SAMESITE')?.trim().toLowerCase();
    if (v === 'none' || v === 'strict' || v === 'lax') {
      return v;
    }
    return 'lax';
  }
}
