/**
 * store resolver 반환용 도메인 출력 타입.
 * SDL(store.types.graphql)의 PopularStore / PopularStoreConnection 와 필드 일치.
 */

export interface PopularStore {
  id: string;
  rank: number;
  storeName: string;
  ratingAverage: number;
  reviewCount: number;
  regionLabel: string | null;
  cakeImageUrls: string[];
}

export interface PopularStoreConnection {
  items: PopularStore[];
  totalCount: number;
  hasMore: boolean;
  rankedAt: Date;
}
