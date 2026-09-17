import type { StoreProductCategoryRow } from '@/features/product/repositories/product.repository';
import type { StoreProductCategory } from '@/features/product/types/product-storefront-output.type';

/** 할인율(0~100, 정수). salePrice가 없거나 비정상(정가 이상)이면 0. */
export function calcDiscountRate(
  regularPrice: number,
  salePrice: number | null,
): number {
  if (salePrice === null || regularPrice <= 0 || salePrice >= regularPrice) {
    return 0;
  }
  // salePrice가 음수 등 비정상 값이어도 공개 계약(0~100)을 지키도록 clamp
  const rate = Math.round((1 - salePrice / regularPrice) * 100);
  return Math.min(100, Math.max(0, rate));
}

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
