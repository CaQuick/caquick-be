/**
 * 인증 도메인 에러 메시지.
 */
export const AUTH_ERROR_MESSAGES = {
  /** OIDC 임시 쿠키(state/nonce/code_verifier)가 없거나 만료됨 */
  OIDC_SESSION_MISSING: 'OIDC session is missing.',
  /** ID 토큰에 sub claim 이 없음 */
  OIDC_SUBJECT_MISSING: 'OIDC subject is missing.',
  /** 계정 upsert 결과가 비어 있음 */
  ACCOUNT_UPSERT_FAILED: 'Account upsert failed.',
  /** 동시 콜백 등으로 같은 소셜 연동이 중복 생성됨 */
  ACCOUNT_IDENTITY_CONFLICT: 'Account identity already exists.',
} as const;
