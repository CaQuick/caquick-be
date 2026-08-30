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
