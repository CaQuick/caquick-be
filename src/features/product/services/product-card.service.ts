import { Injectable } from '@nestjs/common';

import { roundRatingAverage } from '@/common/utils/rating';
import { buildRegionLabel } from '@/common/utils/region-label';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { calcDiscountRate } from '@/features/product/services/product-storefront-mappers.helper';
import type { ProductCardOutput } from '@/features/product/types/product-card-output.type';
import {
  ReviewReadRepository,
  WishlistRepository,
  type ReviewStat,
} from '@/features/review';

export interface ProductCardSource {
  id: bigint;
  store_id: bigint;
  name: string;
  regular_price: number;
  sale_price: number | null;
  images: { image_url: string }[];
  store: {
    store_name: string;
    address_city: string | null;
    address_neighborhood: string | null;
    region: { name: string } | null;
  };
}

/** 대표 이미지·할인율·지역 라벨·평점·찜 여부 규칙을 한 곳에 둔다. */
@Injectable()
export class ProductCardService {
  constructor(
    private readonly repo: ProductRepository,
    private readonly reviews: ReviewReadRepository,
    private readonly wishlists: WishlistRepository,
  ) {}

  async buildCards(
    rows: ProductCardSource[],
    viewerId: bigint | undefined,
    options: { stats?: Map<bigint, ReviewStat> } = {},
  ): Promise<ProductCardOutput[]> {
    if (rows.length === 0) return [];
    const productIds = rows.map((row) => row.id);

    const [stats, wishlistedIds] = await Promise.all([
      options.stats
        ? Promise.resolve(options.stats)
        : this.reviews.aggregateReviewStats('product_id', productIds),
      // 0n도 유효한 계정 id — undefined로만 비로그인을 분기한다
      viewerId !== undefined
        ? this.wishlists.findWishlistedProductIds({
            accountId: viewerId,
            productIds,
          })
        : Promise.resolve(new Set<string>()),
    ]);

    return rows.map((row) => {
      const stat = stats.get(row.id);
      return {
        id: row.id.toString(),
        storeId: row.store_id.toString(),
        name: row.name,
        thumbnailUrl: row.images[0]?.image_url ?? null,
        regularPrice: row.regular_price,
        salePrice: row.sale_price,
        discountRate: calcDiscountRate(row.regular_price, row.sale_price),
        storeName: row.store.store_name,
        regionLabel: buildRegionLabel(row.store),
        ratingAverage: roundRatingAverage(stat?.average ?? 0),
        reviewCount: stat?.count ?? 0,
        isWishlisted: wishlistedIds.has(row.id.toString()),
      };
    });
  }
}
