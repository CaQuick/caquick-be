/**
 * 인증 쿠키 이름 모음
 */
export const AUTH_COOKIE = {
  ACCESS: 'caquick_at',
  REFRESH: 'caquick_rt',

  OIDC_STATE: 'caquick_oidc_state',
  OIDC_NONCE: 'caquick_oidc_nonce',
  OIDC_CODE_VERIFIER: 'caquick_oidc_cv',
  OIDC_RETURN_TO: 'caquick_oidc_return_to',
} as const;
