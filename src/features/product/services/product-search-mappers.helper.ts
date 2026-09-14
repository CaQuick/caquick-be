import { roundRatingAverage } from '@/common/utils/rating';
import {
  FACET_PRICE_BUCKET_MAX,
  FACET_PRICE_BUCKET_SIZE,
} from '@/features/product/constants/product-search.constants';
import type {
  ProductReviewStat,
  ProductSearchCandidateRow,
} from '@/features/product/repositories/product.repository';
import { toProductCardCore } from '@/features/product/services/product-card.helper';
import type {
  SearchPriceBucket,
  SearchProduct,
} from '@/features/product/types/product-search-output.type';

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
    ...toProductCardCore(row.id, row),
    ratingAverage: roundRatingAverage(stat?.average ?? 0),
    reviewCount: stat?.count ?? 0,
    isWishlisted,
  };
}

/**
 * 표시가 목록을 고정 폭 버킷 [min, min+size)으로 센다. 마지막 버킷은 [max, ∞)로
 * maxPrice null. 값이 없는 구간도 count 0으로 모두 반환해 FE가 막대 자리를 고정할 수 있게 한다.
 */
export function buildPriceBuckets(
  prices: number[],
  size: number = FACET_PRICE_BUCKET_SIZE,
  max: number = FACET_PRICE_BUCKET_MAX,
): SearchPriceBucket[] {
  const bucketCount = Math.ceil(max / size);
  const counts = new Array<number>(bucketCount + 1).fill(0);
  for (const price of prices) {
    const index = price >= max ? bucketCount : Math.floor(price / size);
    counts[index] += 1;
  }
  return counts.map((count, i) => ({
    minPrice: i === bucketCount ? max : i * size,
    maxPrice: i === bucketCount ? null : Math.min((i + 1) * size, max),
    count,
  }));
}
