import { BadRequestException } from '@nestjs/common';

/**
 * 지원하는 OIDC Provider 타입
 */
export type OidcProvider = 'google' | 'kakao';

/**
 * OIDC Provider 파라미터를 검증하고 타입으로 변환한다.
 *
 * 호출 컨텍스트: HTTP request path (auth.controller 콜백, oidc-login.service).
 * 따라서 잘못된 값은 도메인 입력 오류로 분류해 4xx 로 반환한다.
 *
 * @param raw provider 문자열
 * @returns provider 타입
 * @throws BadRequestException 지원하지 않는 provider 인 경우
 */
export function parseOidcProvider(raw: string): OidcProvider {
  if (raw === 'google' || raw === 'kakao') return raw;
  throw new BadRequestException(`Unsupported OIDC provider: ${raw}`);
}
