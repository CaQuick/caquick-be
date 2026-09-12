// ── 자격증명 ──

export const MIN_USERNAME_LENGTH = 4;
export const MAX_USERNAME_LENGTH = 80;
/** 정책: 소문자·숫자·`.`·`_`·`-`만. 대소문자 혼용 username 충돌을 원천 차단한다. */
export const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

// ── 계정 텍스트 ──

export const MAX_EMAIL_LENGTH = 320;
export const MAX_ACCOUNT_NAME_LENGTH = 100;
