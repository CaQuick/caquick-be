import type { StoreProductCategoryRow } from '@/features/product/repositories/product.repository';
import type { StoreProductCategory } from '@/features/product/types/product-storefront-output.type';

export function toStoreProductCategory(
  row: StoreProductCategoryRow,
): StoreProductCategory {
  return {
    id: row.id.toString(),
    name: row.name,
    categoryType: row.category_type,
    sortOrder: row.sort_order,
    productCount: row.product_count,
  };
}
