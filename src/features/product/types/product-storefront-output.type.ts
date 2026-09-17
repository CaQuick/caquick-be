import type { CursorConnection } from '@/common/types/cursor-connection.type';
import type { ProductCardOutput } from '@/features/product/types/product-card-output.type';

/**
 * product-storefront resolver 반환용 도메인 출력 타입.
 * SDL(product-storefront.graphql)의 타입과 필드 일치.
 */

export interface StoreProduct {
  product: ProductCardOutput;
  description: string | null;
  currency: string;
  categoryIds: string[];
}

export type StoreProductConnection = CursorConnection<StoreProduct>;

export interface StoreProductCategory {
  id: string;
  name: string;
  categoryType: 'EVENT' | 'STYLE' | 'OTHER';
  sortOrder: number;
  productCount: number;
}
