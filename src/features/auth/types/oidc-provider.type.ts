/**
 * 지원하는 OIDC Provider 타입
 */
export type OidcProvider = 'google' | 'kakao';

/**
 * OIDC Provider 파라미터를 검증하고 타입으로 변환한다.
 *
 * @param raw provider 문자열
 * @returns provider 타입
 */
export function parseOidcProvider(raw: string): OidcProvider {
  if (raw === 'google' || raw === 'kakao') return raw;
  throw new Error(`Unsupported OIDC provider: ${raw}`);
}
