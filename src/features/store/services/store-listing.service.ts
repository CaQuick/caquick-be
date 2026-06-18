import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import {
  DEFAULT_GLOBAL_RATING_PRIOR,
  DEFAULT_POPULAR_STORES_LIMIT,
  RANKING_RECENT_ORDER_DAYS,
} from '@/features/store/constants/store-ranking.constants';
import type { PopularStoresInput } from '@/features/store/dto/inputs/popular-stores.input';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { toPopularStore } from '@/features/store/services/store-mappers.helper';
import {
  popularityScore,
  type StoreMetrics,
} from '@/features/store/services/store-ranking.helper';
import type { PopularStoreConnection } from '@/features/store/types/store-output.type';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class StoreListingService {
  constructor(
    private readonly repo: StoreRepository,
    private readonly wishlistRepo: StoreWishlistRepository,
  ) {}

  /**
   * 인기 매장 리스트. 후보 매장의 주문·찜·평점을 실시간 집계해 점수화·정렬한 뒤
   * 페이지를 잘라 대표 이미지를 채운다.
   *
   * 실시간 집계는 매장 규모가 커지면 캐시/배치(스냅샷)로 최적화할 여지가 있다.
   */
  async popularStores(
    input?: PopularStoresInput,
    accountId?: bigint,
  ): Promise<PopularStoreConnection> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? DEFAULT_POPULAR_STORES_LIMIT;
    const regionIds = input?.regionIds?.map((id) => parseId(id));

    const rankedAt = new Date();
    const candidates = await this.repo.findActiveStoresForRanking(regionIds);
    if (candidates.length === 0) {
      return { items: [], totalCount: 0, hasMore: false, rankedAt };
    }

    const storeIds = candidates.map((c) => c.id);
    const since = new Date(
      rankedAt.getTime() - RANKING_RECENT_ORDER_DAYS * DAY_MS,
    );

    const [wishlistCounts, reviewStats, orderCounts, globalAverage] =
      await Promise.all([
        this.repo.aggregateWishlistCounts(storeIds),
        this.repo.aggregateReviewStats(storeIds),
        this.repo.aggregateRecentOrderCounts(storeIds, since),
        this.repo.globalReviewAverage(),
      ]);
    const prior = globalAverage ?? DEFAULT_GLOBAL_RATING_PRIOR;

    const scored = candidates.map((candidate) => {
      const review = reviewStats.get(candidate.id);
      const metrics: StoreMetrics = {
        recentOrderCount: orderCounts.get(candidate.id) ?? 0,
        wishlistCount: wishlistCounts.get(candidate.id) ?? 0,
        ratingAverage: review?.average ?? 0,
        reviewCount: review?.count ?? 0,
      };
      return { candidate, metrics, score: popularityScore(metrics, prior) };
    });

    // 점수 desc → 리뷰수 desc → id desc (안정적 동점 처리)
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.metrics.reviewCount !== a.metrics.reviewCount) {
        return b.metrics.reviewCount - a.metrics.reviewCount;
      }
      return b.candidate.id > a.candidate.id ? 1 : -1;
    });

    const totalCount = scored.length;
    const page = scored.slice(offset, offset + limit);
    const pageStoreIds = page.map((s) => s.candidate.id);
    const [imagesByStore, wishlistedIds] = await Promise.all([
      this.repo.findStoreCakeImages(pageStoreIds),
      accountId
        ? this.wishlistRepo.findWishlistedStoreIds({
            accountId,
            storeIds: pageStoreIds,
          })
        : Promise.resolve(new Set<string>()),
    ]);

    const items = page.map((entry, idx) =>
      toPopularStore(
        entry.candidate,
        entry.metrics,
        offset + idx + 1,
        imagesByStore.get(entry.candidate.id) ?? [],
        wishlistedIds.has(entry.candidate.id.toString()),
      ),
    );

    return {
      items,
      totalCount,
      hasMore: offset + limit < totalCount,
      rankedAt,
    };
  }
}
