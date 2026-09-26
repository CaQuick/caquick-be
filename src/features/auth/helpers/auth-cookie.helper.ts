import type { CookieOptions, Response } from 'express';

import { OIDC_TEMP_COOKIE_MAX_AGE_MS } from '@/features/auth/constants/auth.constants';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';

export type CookieSameSite = 'lax' | 'strict' | 'none';

export class AuthCookie {
  static setRefreshCookie(
    res: Response,
    args: {
      refreshToken: string;
      refreshMaxAgeMs: number;
      cookieDomain?: string;
      secure: boolean;
      sameSite: CookieSameSite;
    },
  ): void {
    const base: CookieOptions = {
      httpOnly: true,
      secure: args.secure,
      sameSite: args.sameSite,
      path: '/',
      domain: args.cookieDomain,
    };

    res.cookie(AUTH_COOKIE.REFRESH, args.refreshToken, {
      ...base,
      maxAge: args.refreshMaxAgeMs,
    });
  }

  /** secure는 세팅 때와 일치해야 브라우저가 지운다. */
  static clearRefreshCookie(
    res: Response,
    cookieDomain: string | undefined,
    secure: boolean,
    sameSite: CookieSameSite = 'lax',
  ): void {
    const base: CookieOptions = {
      httpOnly: true,
      secure,
      sameSite,
      path: '/',
      domain: cookieDomain,
    };

    res.clearCookie(AUTH_COOKIE.REFRESH, base);
  }

  static setOidcTempCookies(
    res: Response,
    args: {
      state: string;
      nonce: string;
      codeVerifier: string;
      returnTo: string;
      cookieDomain?: string;
      secure: boolean;
      sameSite: CookieSameSite;
    },
  ): void {
    const base: CookieOptions = {
      httpOnly: true,
      secure: args.secure,
      sameSite: args.sameSite,
      path: '/',
      domain: args.cookieDomain,
      maxAge: OIDC_TEMP_COOKIE_MAX_AGE_MS,
    };

    res.cookie(AUTH_COOKIE.OIDC_STATE, args.state, base);
    res.cookie(AUTH_COOKIE.OIDC_NONCE, args.nonce, base);
    res.cookie(AUTH_COOKIE.OIDC_CODE_VERIFIER, args.codeVerifier, base);
    res.cookie(AUTH_COOKIE.OIDC_RETURN_TO, args.returnTo, base);
  }

  /** secure는 세팅 때와 일치해야 브라우저가 지운다. */
  static clearOidcTempCookies(
    res: Response,
    cookieDomain: string | undefined,
    secure: boolean,
    sameSite: CookieSameSite = 'lax',
  ): void {
    const base: CookieOptions = {
      httpOnly: true,
      secure,
      sameSite,
      path: '/',
      domain: cookieDomain,
    };

    res.clearCookie(AUTH_COOKIE.OIDC_STATE, base);
    res.clearCookie(AUTH_COOKIE.OIDC_NONCE, base);
    res.clearCookie(AUTH_COOKIE.OIDC_CODE_VERIFIER, base);
    res.clearCookie(AUTH_COOKIE.OIDC_RETURN_TO, base);
  }
}
