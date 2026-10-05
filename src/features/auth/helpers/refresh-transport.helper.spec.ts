import type { Request } from 'express';

import {
  BODY_TRANSPORT_ROLES,
  loginTransportOf,
  readPresentedRefreshToken,
} from '@/features/auth/helpers/refresh-transport.helper';
import { REFRESH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';
import type { AccountRole } from '@/global/auth/types/jwt-payload.type';

const ROLES: AccountRole[] = ['USER', 'SELLER', 'ADMIN'];
const HEADERS: [string, string | undefined][] = [
  ['mobile', 'mobile'],
  ['Mobile (대소문자·공백)', ' Mobile '],
  ['없음', undefined],
  ['web', 'web'],
];
const BODY_TOKEN = 'b'.repeat(64);
const COOKIE_TOKEN = 'c'.repeat(64);
const BODIES: [string, unknown][] = [
  ['있음', BODY_TOKEN],
  ['빈 문자열', ''],
  ['없음', undefined],
];
const COOKIES: [string, boolean][] = [
  ['있음', true],
  ['없음', false],
];

function reqOf(args: {
  role: AccountRole;
  header?: string;
  body?: unknown;
  cookie?: boolean;
}): Request {
  return {
    headers: args.header === undefined ? {} : { 'x-client': args.header },
    body: args.body === undefined ? {} : { refreshToken: args.body },
    cookies: args.cookie ? { [REFRESH_COOKIE[args.role]]: COOKIE_TOKEN } : {},
  } as unknown as Request;
}

describe('refresh-transport.helper', () => {
  it('바디 전달 허용 역할은 SELLER뿐이다', () => {
    expect([...BODY_TRANSPORT_ROLES]).toEqual(['SELLER']);
  });

  describe('loginTransportOf — 역할 × X-Client 헤더 전수', () => {
    it.each(
      ROLES.flatMap((role) =>
        HEADERS.map(
          ([label, header]): [
            AccountRole,
            string,
            string | undefined,
            string,
          ] => [
            role,
            label,
            header,
            role === 'SELLER' && header?.trim().toLowerCase() === 'mobile'
              ? 'body'
              : 'cookie',
          ],
        ),
      ),
    )('%s + 헤더 %s → %s', (role, _label, header, expected) => {
      expect(loginTransportOf(role, reqOf({ role, header }))).toBe(expected);
    });

    it('헤더가 배열이면 첫 값으로 판정한다', () => {
      const req = {
        headers: { 'x-client': ['mobile', 'web'] },
      } as unknown as Request;
      expect(loginTransportOf('SELLER', req)).toBe('body');
    });

    it('headers가 없는 요청은 쿠키 모드', () => {
      expect(loginTransportOf('SELLER', {} as Request)).toBe('cookie');
    });
  });

  describe('readPresentedRefreshToken — 역할 × 바디 × 쿠키 전수', () => {
    it.each(
      ROLES.flatMap((role) =>
        BODIES.flatMap(([bodyLabel, body]) =>
          COOKIES.map(
            ([cookieLabel, cookie]): [
              AccountRole,
              string,
              string,
              unknown,
              boolean,
              { token: string; transport: string } | undefined,
            ] => [
              role,
              bodyLabel,
              cookieLabel,
              body,
              cookie,
              role === 'SELLER' && body === BODY_TOKEN
                ? { token: BODY_TOKEN, transport: 'body' }
                : cookie
                  ? { token: COOKIE_TOKEN, transport: 'cookie' }
                  : undefined,
            ],
          ),
        ),
      ),
    )(
      '%s + 바디 %s + 쿠키 %s → %o',
      (role, _bodyLabel, _cookieLabel, body, cookie, expected) => {
        expect(
          readPresentedRefreshToken(role, reqOf({ role, body, cookie })),
        ).toEqual(expected);
      },
    );

    it.each([
      ['숫자', 123],
      ['객체', { token: BODY_TOKEN }],
      ['배열', [BODY_TOKEN]],
      ['null', null],
    ])(
      '바디 refreshToken이 문자열이 아니면(%s) 무시하고 쿠키를 읽는다',
      (_label, body) => {
        const req = reqOf({ role: 'SELLER', body, cookie: true });
        expect(readPresentedRefreshToken('SELLER', req)).toEqual({
          token: COOKIE_TOKEN,
          transport: 'cookie',
        });
      },
    );

    it('다른 역할의 쿠키는 읽지 않는다', () => {
      const req = {
        body: {},
        cookies: { [REFRESH_COOKIE.ADMIN]: COOKIE_TOKEN },
      } as unknown as Request;
      expect(readPresentedRefreshToken('SELLER', req)).toBeUndefined();
    });

    it('body·cookies가 없는 요청은 undefined', () => {
      expect(
        readPresentedRefreshToken('SELLER', {} as Request),
      ).toBeUndefined();
    });
  });
});
