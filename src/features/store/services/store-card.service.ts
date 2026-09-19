import { Injectable } from '@nestjs/common';

import { roundRatingAverage } from '@/common/utils/rating';
import { ReviewReadRepository } from '@/features/review';
import { StoreWishlistRepository } from '@/features/review';
import { POPULAR_STORE_CAKE_IMAGE_LIMIT } from '@/features/store/constants/store-ranking.constants';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { buildRegionLabel } from '@/features/store/services/store-mappers.helper';
import type { StoreCardOutput } from '@/features/store/types/store-card-output.type';

export interface StoreCardSource {
  id: bigint;
  store_name: string;
  profile_image_url: string | null;
  address_city: string | null;
  address_neighborhood: string | null;
  region: { name: string } | null;
}

/** 없으면 카드 서비스가 직접 집계한다. */
export interface StoreCardStats {
  ratingAverage: number;
  reviewCount: number;
}

/** 케이크 이미지·찜 여부·평점 반올림·지역 라벨 규칙을 한 곳에 둔다. */
@Injectable()
export class StoreCardService {
  constructor(
    private readonly repo: StoreRepository,
    private readonly wishlistRepo: StoreWishlistRepository,
    private readonly reviews: ReviewReadRepository,
  ) {}

  async buildCards(
    rows: StoreCardSource[],
    viewerId: bigint | undefined,
    options: { stats?: Map<bigint, StoreCardStats>; imageLimit?: number } = {},
  ): Promise<StoreCardOutput[]> {
    if (rows.length === 0) return [];
    const storeIds = rows.map((row) => row.id);

    const [imagesByStore, wishlistedIds, stats] = await Promise.all([
      this.repo.findStoreCakeImages(
        storeIds,
        options.imageLimit ?? POPULAR_STORE_CAKE_IMAGE_LIMIT,
      ),
      // 0n도 유효한 계정 id — undefined로만 비로그인을 분기한다
      viewerId !== undefined
        ? this.wishlistRepo.findWishlistedStoreIds({
            accountId: viewerId,
            storeIds,
          })
        : Promise.resolve(new Set<string>()),
      options.stats
        ? Promise.resolve(options.stats)
        : this.aggregateStats(storeIds),
    ]);

    return rows.map((row) => {
      const stat = stats.get(row.id);
      return {
        id: row.id.toString(),
        storeName: row.store_name,
        profileImageUrl: row.profile_image_url,
        ratingAverage: roundRatingAverage(stat?.ratingAverage ?? 0),
        reviewCount: stat?.reviewCount ?? 0,
        regionLabel: buildRegionLabel(row),
        cakeImageUrls: imagesByStore.get(row.id) ?? [],
        isWishlisted: wishlistedIds.has(row.id.toString()),
      };
    });
  }

  private async aggregateStats(
    storeIds: bigint[],
  ): Promise<Map<bigint, StoreCardStats>> {
    const reviewStats = await this.reviews.aggregateReviewStats(
      'store_id',
      storeIds,
    );
    return new Map(
      [...reviewStats].map(([id, stat]) => [
        id,
        { ratingAverage: stat.average, reviewCount: stat.count },
      ]),
    );
  }
}
