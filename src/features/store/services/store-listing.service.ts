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
import type { StoreSort } from '@/features/store/constants/store-sort.constants';
import type { PopularStoresInput } from '@/features/store/dto/inputs/popular-stores.input';
import { StoreStatsRepository } from '@/features/store/repositories/store-stats.repository';
import {
  StoreRepository,
  type StoreCandidateRow,
} from '@/features/store/repositories/store.repository';
import {
  StoreCardService,
  type StoreCardStats,
} from '@/features/store/services/store-card.service';
import {
  scoreAndSortByPopularity,
  type ScoredCandidate,
} from '@/features/store/services/store-ranking.helper';
import type { PopularStoreConnection } from '@/features/store/types/store-output.type';

export type ScoredStore = ScoredCandidate<StoreCandidateRow>;

export interface SortedStores<T> {
  ordered: T[];
  /** 인기순만 채운다 — 점수에 쓴 리뷰 통계를 카드가 다시 집계하지 않도록. */
  stats?: Map<bigint, StoreCardStats>;
}

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

  /** 매장 검색(후보를 검색어·지역으로 좁힌 뒤)도 같은 인기순을 쓴다. */
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

  /** 동률은 id desc로 고정한다(인기순은 리뷰 수 desc가 먼저). */
  async sortStores<T extends StoreCandidateRow>(
    candidates: T[],
    sort: StoreSort,
    at: Date,
  ): Promise<SortedStores<T>> {
    switch (sort) {
      case 'POPULAR': {
        const scored = await this.scoreStores(candidates, at);
        return {
          ordered: scored.map((entry) => entry.candidate),
          stats: new Map(
            scored.map((entry) => [entry.candidate.id, entry.metrics]),
          ),
        };
      }
      case 'BEST_SELLING': {
        const sold = await this.stats.aggregateSoldQuantities(
          'store_id',
          candidates.map((c) => c.id),
          new Date(at.getTime() - RANKING_RECENT_ORDER_DAYS * DAY_MS),
        );
        return {
          ordered: [...candidates].sort(
            (a, b) =>
              (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) ||
              compareIdDesc(a, b),
          ),
        };
      }
      case 'LATEST':
        return {
          ordered: [...candidates].sort(
            (a, b) =>
              b.created_at.getTime() - a.created_at.getTime() ||
              compareIdDesc(a, b),
          ),
        };
    }
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

function compareIdDesc(a: { id: bigint }, b: { id: bigint }): number {
  if (a.id === b.id) return 0;
  return b.id > a.id ? 1 : -1;
}
