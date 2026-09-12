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
  /** username/password 로그인 실패. 존재·타입·비밀번호 오류를 구분하지 않는다(계정 열거 방지) */
  INVALID_CREDENTIALS: 'Invalid credentials.',
  /** refresh 쿠키 없음 */
  MISSING_REFRESH_TOKEN: 'Missing refresh token.',
  /** refresh 세션이 없거나 계정 타입이 경로와 다름 */
  INVALID_REFRESH_TOKEN: 'Invalid refresh token.',
  /** 비밀번호 변경 대상 자격증명이 없음 */
  CREDENTIAL_NOT_FOUND: 'Credential not found.',
  /** 자격증명의 계정 타입이 요청 경로(seller/admin)와 다름 */
  ROLE_MISMATCH: 'Account type does not match this endpoint.',
  /** 현재 비밀번호 불일치 */
  CURRENT_PASSWORD_INVALID: 'Current password is invalid.',
  /** 새 비밀번호가 현재와 같음 */
  PASSWORD_UNCHANGED: 'New password must be different from current password.',
} as const;
