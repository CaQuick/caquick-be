// 관리자가 만드는 자격증명 계정(관리자·판매자)과 계정 목록 검색의 입력 정책.

export const MIN_USERNAME_LENGTH = 4;
export const MAX_USERNAME_LENGTH = 80;
/** 정책: 소문자·숫자·`.`·`_`·`-`만. 대소문자 혼용 username 충돌을 원천 차단한다. */
export const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

export const MAX_EMAIL_LENGTH = 320;
export const MAX_ACCOUNT_NAME_LENGTH = 100;
export const MAX_SELLER_WEBSITE_URL_LENGTH = 2048;

export const ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED'] as const;
export type AccountStatusValue = (typeof ACCOUNT_STATUSES)[number];
