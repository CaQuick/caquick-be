import type { CursorConnection } from '@/common/types/cursor-connection.type';
import type { ProductCardOutput } from '@/features/product/types/product-card-output.type';

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
