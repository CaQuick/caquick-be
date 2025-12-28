import type { CookieOptions, Response } from 'express';

import { AUTH_COOKIE } from '../../../global/auth/constants/auth-cookie.constants';
import { OIDC_TEMP_COOKIE_MAX_AGE_MS } from '../constants/auth.constants';

/**
 * Auth Cookie 설정을 생성한다.
 */
export class AuthCookie {
  /**
   * Refresh 쿠키를 세팅한다.
   *
   * @param res express Response
   * @param args 토큰/만료/옵션
   */
  static setRefreshCookie(
    res: Response,
    args: {
      refreshToken: string;
      refreshMaxAgeMs: number;
      cookieDomain?: string;
      secure: boolean;
    },
  ): void {
    const base: CookieOptions = {
      httpOnly: true,
      secure: args.secure,
      sameSite: 'lax',
      path: '/',
      domain: args.cookieDomain,
    };

    res.cookie(AUTH_COOKIE.REFRESH, args.refreshToken, {
      ...base,
      maxAge: args.refreshMaxAgeMs,
    });
  }

  /**
   * Refresh 쿠키를 삭제한다.
   *
   * @param res express Response
   * @param cookieDomain 쿠키 도메인
   * @param secure secure 여부(옵션 일치 필요)
   */
  static clearRefreshCookie(
    res: Response,
    cookieDomain: string | undefined,
    secure: boolean,
  ): void {
    const base: CookieOptions = {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      domain: cookieDomain,
    };

    res.clearCookie(AUTH_COOKIE.REFRESH, base);
  }

  /**
   * OIDC 임시 쿠키를 세팅한다.
   *
   * @param res express Response
   * @param args state/nonce/cv/returnTo 및 옵션
   */
  static setOidcTempCookies(
    res: Response,
    args: {
      state: string;
      nonce: string;
      codeVerifier: string;
      returnTo: string;
      cookieDomain?: string;
      secure: boolean;
    },
  ): void {
    const base: CookieOptions = {
      httpOnly: true,
      secure: args.secure,
      sameSite: 'lax',
      path: '/',
      domain: args.cookieDomain,
      maxAge: OIDC_TEMP_COOKIE_MAX_AGE_MS,
    };

    res.cookie(AUTH_COOKIE.OIDC_STATE, args.state, base);
    res.cookie(AUTH_COOKIE.OIDC_NONCE, args.nonce, base);
    res.cookie(AUTH_COOKIE.OIDC_CODE_VERIFIER, args.codeVerifier, base);
    res.cookie(AUTH_COOKIE.OIDC_RETURN_TO, args.returnTo, base);
  }

  /**
   * OIDC 임시 쿠키를 삭제한다.
   *
   * @param res express Response
   * @param cookieDomain 쿠키 도메인
   * @param secure secure 여부
   */
  static clearOidcTempCookies(
    res: Response,
    cookieDomain: string | undefined,
    secure: boolean,
  ): void {
    const base: CookieOptions = {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      domain: cookieDomain,
    };

    res.clearCookie(AUTH_COOKIE.OIDC_STATE, base);
    res.clearCookie(AUTH_COOKIE.OIDC_NONCE, base);
    res.clearCookie(AUTH_COOKIE.OIDC_CODE_VERIFIER, base);
    res.clearCookie(AUTH_COOKIE.OIDC_RETURN_TO, base);
  }
}
