/**
 * product-search resolver 반환용 도메인 출력 타입.
 * SDL(product-search.graphql)의 타입과 필드 일치.
 */

export interface SearchProduct {
  id: string;
  storeId: string;
  name: string;
  thumbnailUrl: string | null;
  storeName: string;
  regionLabel: string | null;
  regularPrice: number;
  salePrice: number | null;
  discountRate: number;
  ratingAverage: number;
  reviewCount: number;
  isWishlisted: boolean;
}

export interface SearchProductConnection {
  items: SearchProduct[];
  totalCount: number;
  hasMore: boolean;
}

export interface SearchPriceBucket {
  minPrice: number;
  maxPrice: number | null;
  count: number;
}

export interface SearchProductFacets {
  buckets: SearchPriceBucket[];
  minPrice: number | null;
  maxPrice: number | null;
  totalCount: number;
}
