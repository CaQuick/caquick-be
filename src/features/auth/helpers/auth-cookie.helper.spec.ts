import type { Response } from 'express';

import { AuthCookie } from '@/features/auth/helpers/auth-cookie.helper';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';

function mockRes(): Response & {
  _cookies: Record<string, unknown>;
  _cleared: string[];
} {
  const cookies: Record<string, unknown> = {};
  const cleared: string[] = [];
  return {
    _cookies: cookies,
    _cleared: cleared,
    cookie: jest.fn((name: string, value: unknown, opts: unknown) => {
      cookies[name] = { value, opts };
    }),
    clearCookie: jest.fn((name: string) => {
      cleared.push(name);
    }),
  } as unknown as Response & {
    _cookies: Record<string, unknown>;
    _cleared: string[];
  };
}

describe('AuthCookie', () => {
  describe('setRefreshCookie', () => {
    it('refresh 쿠키를 httpOnly, secure 옵션으로 설정한다', () => {
      const res = mockRes();
      AuthCookie.setRefreshCookie(res, {
        refreshToken: 'token-abc',
        refreshMaxAgeMs: 604800000,
        cookieDomain: '.caquick.site',
        secure: true,
        sameSite: 'lax',
      });

      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE.REFRESH,
        'token-abc',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          maxAge: 604800000,
          domain: '.caquick.site',
        }),
      );
    });
  });

  describe('clearRefreshCookie', () => {
    it('refresh 쿠키를 삭제한다', () => {
      const res = mockRes();
      AuthCookie.clearRefreshCookie(res, '.caquick.site', true, 'lax');

      expect(res.clearCookie).toHaveBeenCalledWith(
        AUTH_COOKIE.REFRESH,
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          domain: '.caquick.site',
        }),
      );
    });

    it('sameSite 기본값은 lax이다', () => {
      const res = mockRes();
      AuthCookie.clearRefreshCookie(res, undefined, false);

      expect(res.clearCookie).toHaveBeenCalledWith(
        AUTH_COOKIE.REFRESH,
        expect.objectContaining({ sameSite: 'lax' }),
      );
    });
  });

  describe('setOidcTempCookies', () => {
    it('OIDC 임시 쿠키 4개를 설정한다', () => {
      const res = mockRes();
      AuthCookie.setOidcTempCookies(res, {
        state: 'state-val',
        nonce: 'nonce-val',
        codeVerifier: 'cv-val',
        returnTo: 'https://caquick.site',
        secure: false,
        sameSite: 'lax',
      });

      expect(res.cookie).toHaveBeenCalledTimes(4);
      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE.OIDC_STATE,
        'state-val',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE.OIDC_NONCE,
        'nonce-val',
        expect.any(Object),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE.OIDC_CODE_VERIFIER,
        'cv-val',
        expect.any(Object),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE.OIDC_RETURN_TO,
        'https://caquick.site',
        expect.any(Object),
      );
    });
  });

  describe('clearOidcTempCookies', () => {
    it('OIDC 임시 쿠키 4개를 삭제한다', () => {
      const res = mockRes();
      AuthCookie.clearOidcTempCookies(res, '.caquick.site', true, 'lax');

      expect(res.clearCookie).toHaveBeenCalledTimes(4);
      expect(res._cleared).toContain(AUTH_COOKIE.OIDC_STATE);
      expect(res._cleared).toContain(AUTH_COOKIE.OIDC_NONCE);
      expect(res._cleared).toContain(AUTH_COOKIE.OIDC_CODE_VERIFIER);
      expect(res._cleared).toContain(AUTH_COOKIE.OIDC_RETURN_TO);
    });
  });
});
