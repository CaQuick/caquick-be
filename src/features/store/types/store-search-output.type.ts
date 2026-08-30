/**
 * store-search resolver 반환용 도메인 출력 타입.
 * SDL(store-search.graphql)의 타입과 필드 일치.
 */

export interface SearchStore {
  id: string;
  storeName: string;
  profileImageUrl: string | null;
  ratingAverage: number;
  reviewCount: number;
  regionLabel: string | null;
  cakeImageUrls: string[];
  isWishlisted: boolean;
}

export interface SearchStoreConnection {
  items: SearchStore[];
  totalCount: number;
  hasMore: boolean;
}
