import type { Request } from 'express';

import { REFRESH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';
import type { AccountRole } from '@/global/auth/types/jwt-payload.type';

export type RefreshTransport = 'cookie' | 'body';

/** 바디 전달을 허용하는 역할. 구매자는 OIDC 302 콜백이라 바디에 실을 수 없고, 관리자는 모바일이 없다. */
export const BODY_TRANSPORT_ROLES: ReadonlySet<AccountRole> =
  new Set<AccountRole>(['SELLER']);

export const CLIENT_HEADER = 'x-client';
const MOBILE_CLIENT = 'mobile';

/** 로그인 응답의 전달 방식 — 허용 역할이 `X-Client: mobile`을 보낼 때만 바디. */
export function loginTransportOf(
  role: AccountRole,
  req: Request,
): RefreshTransport {
  if (!BODY_TRANSPORT_ROLES.has(role)) return 'cookie';
  const header = req.headers?.[CLIENT_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' &&
    value.trim().toLowerCase() === MOBILE_CLIENT
    ? 'body'
    : 'cookie';
}

export interface PresentedRefreshToken {
  token: string;
  transport: RefreshTransport;
}

/**
 * refresh·logout이 받은 토큰과 그 출처. 허용 역할의 바디 `refreshToken`이 있으면 바디 모드이고
 * 쿠키는 읽지 않는다 — 웹뷰가 쿠키를 함께 보내도 앱 세션만 회전·폐기한다.
 */
export function readPresentedRefreshToken(
  role: AccountRole,
  req: Request,
): PresentedRefreshToken | undefined {
  if (BODY_TRANSPORT_ROLES.has(role)) {
    const token = (req.body as { refreshToken?: unknown } | undefined)
      ?.refreshToken;
    if (typeof token === 'string' && token) return { token, transport: 'body' };
  }
  const cookie = req.cookies?.[REFRESH_COOKIE[role]] as unknown;
  return typeof cookie === 'string' && cookie
    ? { token: cookie, transport: 'cookie' }
    : undefined;
}
