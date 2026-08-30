export const PRODUCT_SEARCH_SORTS = [
  'POPULAR',
  'LATEST',
  'BEST_SELLING',
  'PRICE_ASC',
  'PRICE_DESC',
] as const;
export type ProductSearchSort = (typeof PRODUCT_SEARCH_SORTS)[number];

export const DEFAULT_PRODUCT_SEARCH_SORT: ProductSearchSort = 'POPULAR';

/** 검색 목록 기본/최대 페이지 크기(상품·매장 공통 정책). */
export const DEFAULT_SEARCH_PAGE_LIMIT = 20;
export const MAX_SEARCH_PAGE_LIMIT = 50;

/** 가격 분포 버킷 폭(원). 시안 슬라이더 눈금(2만~7만 이상)을 5,000원 단위로 나눈다(자체 판단). */
export const FACET_PRICE_BUCKET_SIZE = 5000;

/** 가격 분포 상한(원). 이 값 이상은 마지막 '이상' 버킷으로 묶는다(시안 '7만원 이상'). */
export const FACET_PRICE_BUCKET_MAX = 70000;
