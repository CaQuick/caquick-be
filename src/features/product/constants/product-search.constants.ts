export const PRODUCT_SEARCH_SORTS = [
  'POPULAR',
  'LATEST',
  'BEST_SELLING',
  'PRICE_ASC',
  'PRICE_DESC',
] as const;
export type ProductSearchSort = (typeof PRODUCT_SEARCH_SORTS)[number];

export const DEFAULT_PRODUCT_SEARCH_SORT: ProductSearchSort = 'POPULAR';

export const DEFAULT_SEARCH_PAGE_LIMIT = 20;
export const MAX_SEARCH_PAGE_LIMIT = 50;

/** 시안 슬라이더 눈금(2만~7만 이상)을 5,000원 단위로 나눈다. */
export const FACET_PRICE_BUCKET_SIZE = 5000;

/** 이 값 이상은 마지막 '이상' 버킷으로 묶는다. */
export const FACET_PRICE_BUCKET_MAX = 70000;
