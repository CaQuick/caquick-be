import { DomainException } from '@/common/errors/error-catalog';
export type OidcProvider = 'google' | 'kakao';

/** HTTP 경로 파라미터라 잘못된 값은 도메인 입력 오류(4xx)로 분류한다. */
export function parseOidcProvider(raw: string): OidcProvider {
  if (raw === 'google' || raw === 'kakao') return raw;
  throw new DomainException('UNSUPPORTED_OIDC_PROVIDER', { provider: raw });
}
