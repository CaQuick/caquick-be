export const DEFAULT_REVIEWS_LIMIT = 20;

export const REVIEW_SORTS = ['LATEST', 'LIKES'] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];
