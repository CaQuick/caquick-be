export const STORE_SORTS = ['POPULAR', 'LATEST', 'BEST_SELLING'] as const;
export type StoreSort = (typeof STORE_SORTS)[number];

export const DEFAULT_STORE_SORT: StoreSort = 'POPULAR';
