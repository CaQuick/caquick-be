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

// 이름은 리터럴로 고정한다 — 운영 쿠키 이름이 바뀌면 전 세션이 끊긴다
const REFRESH_COOKIE_NAMES = [
  ['USER', 'caquick_rt'],
  ['SELLER', 'caquick_seller_rt'],
  ['ADMIN', 'caquick_admin_rt'],
] as const;

describe('AuthCookie', () => {
  describe('setRefreshCookie', () => {
    it.each(REFRESH_COOKIE_NAMES)(
      '%s refresh 쿠키 이름은 %s이다',
      (role, name) => {
        const res = mockRes();
        AuthCookie.setRefreshCookie(res, role, {
          refreshToken: 'token-abc',
          refreshMaxAgeMs: 1000,
          secure: false,
          sameSite: 'lax',
        });

        expect(res.cookie).toHaveBeenCalledTimes(1);
        expect(res.cookie).toHaveBeenCalledWith(
          name,
          'token-abc',
          expect.any(Object),
        );
      },
    );

    it('refresh 쿠키를 httpOnly, secure 옵션으로 설정한다', () => {
      const res = mockRes();
      AuthCookie.setRefreshCookie(res, 'USER', {
        refreshToken: 'token-abc',
        refreshMaxAgeMs: 604800000,
        cookieDomain: '.caquick.site',
        secure: true,
        sameSite: 'lax',
      });

      expect(res.cookie).toHaveBeenCalledWith(
        'caquick_rt',
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
    it.each(REFRESH_COOKIE_NAMES)(
      '%s refresh 쿠키는 %s만 지운다',
      (role, name) => {
        const res = mockRes();
        AuthCookie.clearRefreshCookie(res, role, undefined, false);

        expect(res._cleared).toEqual([name]);
      },
    );

    it('refresh 쿠키를 삭제한다', () => {
      const res = mockRes();
      AuthCookie.clearRefreshCookie(res, 'USER', '.caquick.site', true, 'lax');

      expect(res.clearCookie).toHaveBeenCalledWith(
        'caquick_rt',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          domain: '.caquick.site',
        }),
      );
    });

    it('sameSite 기본값은 lax이다', () => {
      const res = mockRes();
      AuthCookie.clearRefreshCookie(res, 'USER', undefined, false);

      expect(res.clearCookie).toHaveBeenCalledWith(
        'caquick_rt',
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
