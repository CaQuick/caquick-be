/**
 * CORS 허용 오리진. 운영은 고정 목록(env로 바뀌지 않게), 비운영은 FRONTEND_BASE_URL 목록이고 비어 있으면 로컬 FE 기본값.
 * 관리자 웹은 refresh 쿠키가 API와 same-site라 오리진만 열면 된다 — 쿠키 도메인 변경 불필요.
 * caquick.site는 2026-11-29 만료까지 caquick.com과 병행한다(전환 전에 받은 페이지가 옛 API를 부른다).
 */
export const PROD_ALLOWED_ORIGINS: readonly string[] = [
  'https://caquick.com',
  'https://admin.caquick.com',
  'https://www.caquick.site',
  'https://caquick.site',
  'https://caquick-fe.vercel.app',
  'https://admin.caquick.site',
];

export const DEV_DEFAULT_ORIGINS: readonly string[] = ['http://localhost:3000'];

export function resolveAllowedOrigins(
  isProd: boolean,
  frontendOrigins: readonly string[],
): string[] {
  if (isProd) return [...PROD_ALLOWED_ORIGINS];
  return frontendOrigins.length > 0
    ? [...frontendOrigins]
    : [...DEV_DEFAULT_ORIGINS];
}
