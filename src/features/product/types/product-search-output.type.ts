import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { ProductCardOutput } from '@/features/product/types/product-card-output.type';

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
