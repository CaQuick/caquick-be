import { Injectable } from '@nestjs/common';

import { roundRatingAverage } from '@/common/utils/rating';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { calcDiscountRate } from '@/features/product/services/product-storefront-mappers.helper';
import type { ProductCardOutput } from '@/features/product/types/product-card-output.type';
import { ReviewReadRepository, type ReviewStat } from '@/features/review';
import { buildRegionLabel } from '@/features/store';

/** 카드에 필요한 상품 row 부분집합. 랭킹·검색·매장 상품·찜·최근 본 상품 row가 모두 만족한다. */
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

/**
 * 상품 카드 1벌(D28). 인기 케이크·판매 Best·검색·매장 상품·찜·최근 본 상품이 같은 카드를 쓴다 —
 * 대표 이미지·할인율·지역 라벨·평점·찜 여부 규칙을 한 곳에 둔다.
 */
@Injectable()
export class ProductCardService {
  constructor(
    private readonly repo: ProductRepository,
    private readonly reviews: ReviewReadRepository,
  ) {}

  /** rows 순서를 유지한 카드 배열. viewerId가 없으면(비로그인) isWishlisted는 전부 false. */
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
        ? this.repo.findWishlistedProductIds({
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
