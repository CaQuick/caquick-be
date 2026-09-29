import type { AccountRole } from '@/global/auth/types/jwt-payload.type';

export const AUTH_COOKIE = {
  OIDC_STATE: 'caquick_oidc_state',
  OIDC_NONCE: 'caquick_oidc_nonce',
  OIDC_CODE_VERIFIER: 'caquick_oidc_cv',
  OIDC_RETURN_TO: 'caquick_oidc_return_to',
} as const;

/**
 * 구매자·판매자·관리자 웹이 같은 API 호스트에 쿠키를 보내므로 역할마다 이름을 나눈다 — 한 이름이면
 * 나중에 로그인한 쪽이 먼저 로그인한 쪽의 세션을 덮어쓴다. USER는 기존 구매자 세션을 살리려고 옛 이름을 유지한다.
 */
export const REFRESH_COOKIE = {
  USER: 'caquick_rt',
  SELLER: 'caquick_seller_rt',
  ADMIN: 'caquick_admin_rt',
} as const satisfies Record<AccountRole, string>;
