import type { ConfigService } from '@nestjs/config';

import { getEnvAsBoolean } from '@/common/helpers/config.helper';
import type { CookieSameSite } from '@/features/auth/helpers/auth-cookie.helper';

/** Token/OIDC/Logout이 같은 쿠키 옵션을 쓰므로 한곳에 모은다. */
export class AuthCookieOptions {
  static getCookieDomain(config: ConfigService): string | undefined {
    const v = config.get<string>('AUTH_COOKIE_DOMAIN');
    const trimmed = v?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  }

  static isCookieSecure(config: ConfigService): boolean {
    const envValue = config.get<string>('AUTH_COOKIE_SECURE');
    if (envValue !== undefined) {
      return getEnvAsBoolean(config, 'AUTH_COOKIE_SECURE', false);
    }
    return (config.get<string>('NODE_ENV') ?? '') === 'production';
  }

  static getCookieSameSite(config: ConfigService): CookieSameSite {
    const v = config.get<string>('AUTH_COOKIE_SAMESITE')?.trim().toLowerCase();
    if (v === 'none' || v === 'strict' || v === 'lax') {
      return v;
    }
    return 'lax';
  }
}
