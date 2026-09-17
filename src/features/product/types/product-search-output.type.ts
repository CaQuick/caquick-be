import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { ProductCardOutput } from '@/features/product/types/product-card-output.type';

/**
 * product-search resolver 반환용 도메인 출력 타입.
 * SDL(product-search.graphql)의 타입과 필드 일치.
 */

export type SearchProductConnection = OffsetConnection<ProductCardOutput>;

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
