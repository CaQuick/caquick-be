// 관리자 상품 관리(배너·카테고리·태그) 입력 정책. URL 길이는 product-seller.constants의 MAX_URL_LENGTH와 공유한다.

// ── 배너 ──

export const MAX_BANNER_TITLE_LENGTH = 200;
export const BANNER_PLACEMENTS = [
  'HOME_MAIN',
  'HOME_SUB',
  'CATEGORY',
  'STORE',
  'SEARCH',
] as const;
export type BannerPlacementValue = (typeof BANNER_PLACEMENTS)[number];
export const BANNER_LINK_TYPES = [
  'NONE',
  'URL',
  'PRODUCT',
  'STORE',
  'CATEGORY',
] as const;
export type BannerLinkTypeValue = (typeof BANNER_LINK_TYPES)[number];

// ── 카테고리·태그 마스터 ──

export const CATEGORY_TYPES = ['EVENT', 'STYLE', 'OTHER'] as const;
export type CategoryTypeValue = (typeof CATEGORY_TYPES)[number];
export const MAX_CATEGORY_NAME_LENGTH = 100;
export const MAX_CATEGORY_DESCRIPTION_LENGTH = 255;
export const MAX_TAG_NAME_LENGTH = 80;
