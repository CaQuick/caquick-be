import { roundRatingAverage } from '@/common/utils/rating';
import type {
  ProductReviewStat,
  ProductSearchCandidateRow,
} from '@/features/product/repositories/product.repository';
import { calcDiscountRate } from '@/features/product/services/product-storefront-mappers.helper';
import type { SearchProduct } from '@/features/product/types/product-search-output.type';
import { buildRegionLabel } from '@/features/store';

/** 표시가(할인가 우선). 가격 필터·가격 정렬이 공유하는 단일 규칙. */
export function displayPrice(row: {
  regular_price: number;
  sale_price: number | null;
}): number {
  return row.sale_price ?? row.regular_price;
}

export function toSearchProduct(
  row: ProductSearchCandidateRow,
  stat: ProductReviewStat | undefined,
  isWishlisted: boolean,
): SearchProduct {
  return {
    id: row.id.toString(),
    storeId: row.store_id.toString(),
    name: row.name,
    thumbnailUrl: row.images[0]?.image_url ?? null,
    storeName: row.store.store_name,
    regionLabel: buildRegionLabel(row.store),
    regularPrice: row.regular_price,
    salePrice: row.sale_price,
    discountRate: calcDiscountRate(row.regular_price, row.sale_price),
    ratingAverage: roundRatingAverage(stat?.average ?? 0),
    reviewCount: stat?.count ?? 0,
    isWishlisted,
  };
}
