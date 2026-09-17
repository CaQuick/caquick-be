/** 리뷰 목록 기본 페이지 크기(상품·매장 공통). */
export const DEFAULT_REVIEWS_LIMIT = 20;

/** 리뷰 목록 정렬(SDL ReviewSort). */
export const REVIEW_SORTS = ['LATEST', 'LIKES'] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];
