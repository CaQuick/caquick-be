/**
 * product-storefront resolver 반환용 도메인 출력 타입.
 * SDL(product-storefront.graphql)의 타입과 필드 일치.
 */

export interface StoreProduct {
  id: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  regularPrice: number;
  salePrice: number | null;
  discountRate: number;
  currency: string;
  categoryIds: string[];
}

export interface StoreProductConnection {
  items: StoreProduct[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface StoreProductCategory {
  id: string;
  name: string;
  categoryType: 'EVENT' | 'STYLE' | 'OTHER';
  sortOrder: number;
  productCount: number;
}
