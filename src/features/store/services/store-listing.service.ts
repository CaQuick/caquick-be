import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { DAY_MS } from '@/common/utils/kst-time';
import { hasMoreByOffset } from '@/common/utils/pagination';
import { ReviewReadRepository } from '@/features/review';
import { StoreWishlistRepository } from '@/features/review';
import {
  DEFAULT_GLOBAL_RATING_PRIOR,
  DEFAULT_POPULAR_STORES_LIMIT,
  RANKING_RECENT_ORDER_DAYS,
} from '@/features/store/constants/store-ranking.constants';
import type { PopularStoresInput } from '@/features/store/dto/inputs/popular-stores.input';
import { StoreStatsRepository } from '@/features/store/repositories/store-stats.repository';
import {
  StoreRepository,
  type StoreCandidateRow,
} from '@/features/store/repositories/store.repository';
import { StoreCardService } from '@/features/store/services/store-card.service';
import {
  scoreAndSortByPopularity,
  type ScoredCandidate,
} from '@/features/store/services/store-ranking.helper';
import type { PopularStoreConnection } from '@/features/store/types/store-output.type';

export type ScoredStore = ScoredCandidate<StoreCandidateRow>;

@Injectable()
export class StoreListingService {
  constructor(
    private readonly repo: StoreRepository,
    private readonly wishlistRepo: StoreWishlistRepository,
    private readonly reviews: ReviewReadRepository,
    private readonly stats: StoreStatsRepository,
    private readonly cards: StoreCardService,
  ) {}

  /** popularStores와 todayPickupStores가 동일 랭킹 정책을 공유한다. 실시간 집계는 매장 규모가 커지면 캐시/배치(스냅샷)로 최적화할 여지가 있다. */
  async rankActiveStores(
    regionIds: bigint[] | undefined,
    rankedAt: Date,
  ): Promise<ScoredStore[]> {
    const candidates = await this.repo.findActiveStoresForRanking(regionIds);
    return this.scoreStores(candidates, rankedAt);
  }

  /** 키워드 매장 검색(후보를 검색어로 좁힌 뒤)도 같은 인기순을 쓴다. */
  async scoreStores<T extends StoreCandidateRow>(
    candidates: T[],
    rankedAt: Date,
  ): Promise<ScoredCandidate<T>[]> {
    if (candidates.length === 0) return [];

    const storeIds = candidates.map((c) => c.id);
    const since = new Date(
      rankedAt.getTime() - RANKING_RECENT_ORDER_DAYS * DAY_MS,
    );

    const [wishlistCounts, reviewStats, orderCounts, globalAverage] =
      await Promise.all([
        this.repo.aggregateWishlistCounts(storeIds),
        this.reviews.aggregateReviewStats('store_id', storeIds),
        this.stats.aggregateRecentOrderCounts('store_id', storeIds, since),
        this.reviews.globalReviewAverage(),
      ]);
    const prior = globalAverage ?? DEFAULT_GLOBAL_RATING_PRIOR;

    return scoreAndSortByPopularity(
      candidates,
      { wishlistCounts, reviewStats, recentOrderCounts: orderCounts },
      prior,
    );
  }

  async popularStores(
    input?: PopularStoresInput,
    accountId?: bigint,
  ): Promise<PopularStoreConnection> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? DEFAULT_POPULAR_STORES_LIMIT;
    const regionIds = input?.regionIds?.map((id) => parseId(id));

    const rankedAt = new Date();
    const scored = await this.rankActiveStores(regionIds, rankedAt);
    if (scored.length === 0) {
      return { items: [], totalCount: 0, hasMore: false, rankedAt };
    }

    const totalCount = scored.length;
    const page = scored.slice(offset, offset + limit);
    const cards = await this.cards.buildCards(
      page.map((entry) => entry.candidate),
      accountId,
      {
        stats: new Map(
          page.map((entry) => [entry.candidate.id, entry.metrics]),
        ),
      },
    );
    const items = cards.map((store, idx) => ({
      rank: offset + idx + 1,
      store,
    }));

    return {
      items,
      totalCount,
      hasMore: hasMoreByOffset(offset, limit, totalCount),
      rankedAt,
    };
  }
}
