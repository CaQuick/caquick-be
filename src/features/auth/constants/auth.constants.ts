/**
 * OIDC 임시 쿠키 유효 시간 (10분)
 */
export const OIDC_TEMP_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * 허용된 returnTo 도메인 목록
 * (오픈 리다이렉트 방지)
 */
export const ALLOWED_RETURN_TO_DOMAINS = [
  'https://www.caquick.site',
  'https://caquick.site',
  'http://localhost:3000',
] as const;
