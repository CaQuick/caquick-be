// ── 자격증명 ──

export const MIN_USERNAME_LENGTH = 4;
export const MAX_USERNAME_LENGTH = 80;
/** 정책: 소문자·숫자·`.`·`_`·`-`만. 대소문자 혼용 username 충돌을 원천 차단한다. */
export const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

// ── 계정 텍스트 ──

export const MAX_EMAIL_LENGTH = 320;
export const MAX_ACCOUNT_NAME_LENGTH = 100;

// ── 배너 ──

export const MAX_URL_LENGTH = 2048;
export const MAX_BANNER_TITLE_LENGTH = 200;
/** SDL BannerPlacement와 1:1. DTO @IsIn 검증용. */
export const BANNER_PLACEMENTS = [
  'HOME_MAIN',
  'HOME_SUB',
  'CATEGORY',
  'STORE',
  'SEARCH',
] as const;
export type BannerPlacementValue = (typeof BANNER_PLACEMENTS)[number];
/** SDL BannerLinkType와 1:1. */
export const BANNER_LINK_TYPES = [
  'NONE',
  'URL',
  'PRODUCT',
  'STORE',
  'CATEGORY',
] as const;
export type BannerLinkTypeValue = (typeof BANNER_LINK_TYPES)[number];
