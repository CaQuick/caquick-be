import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { DAY_MS } from '@/common/utils/kst-time';
import { hasMoreByOffset } from '@/common/utils/pagination';
import {
  DEFAULT_GLOBAL_RATING_PRIOR,
  DEFAULT_POPULAR_STORES_LIMIT,
  RANKING_RECENT_ORDER_DAYS,
} from '@/features/store/constants/store-ranking.constants';
import type { PopularStoresInput } from '@/features/store/dto/inputs/popular-stores.input';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import {
  StoreRepository,
  type StoreCandidateRow,
} from '@/features/store/repositories/store.repository';
import { toPopularStore } from '@/features/store/services/store-mappers.helper';
import {
  scoreAndSortByPopularity,
  type ScoredCandidate,
} from '@/features/store/services/store-ranking.helper';
import type { PopularStoreConnection } from '@/features/store/types/store-output.type';

/** 점수화·정렬이 끝난 랭킹 항목. */
export type ScoredStore = ScoredCandidate<StoreCandidateRow>;

@Injectable()
export class StoreListingService {
  constructor(
    private readonly repo: StoreRepository,
    private readonly wishlistRepo: StoreWishlistRepository,
  ) {}

  /**
   * 활성 매장 후보의 주문·찜·평점을 실시간 집계해 점수화·정렬한다.
   * popularStores와 todayPickupStores가 동일 랭킹 정책을 공유한다.
   *
   * 실시간 집계는 매장 규모가 커지면 캐시/배치(스냅샷)로 최적화할 여지가 있다.
   */
  async rankActiveStores(
    regionIds: bigint[] | undefined,
    rankedAt: Date,
  ): Promise<ScoredStore[]> {
    const candidates = await this.repo.findActiveStoresForRanking(regionIds);
    return this.scoreStores(candidates, rankedAt);
  }

  /**
   * 주어진 후보 매장의 주문·찜·평점을 집계해 점수화·정렬한다.
   * 키워드 매장 검색(후보를 검색어로 좁힌 뒤)도 같은 인기순을 쓴다.
   */
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
        this.repo.aggregateReviewStats(storeIds),
        this.repo.aggregateRecentOrderCounts(storeIds, since),
        this.repo.globalReviewAverage(),
      ]);
    const prior = globalAverage ?? DEFAULT_GLOBAL_RATING_PRIOR;

    return scoreAndSortByPopularity(
      candidates,
      { wishlistCounts, reviewStats, recentOrderCounts: orderCounts },
      prior,
    );
  }

  /**
   * 인기 매장 리스트. 랭킹 후 페이지를 잘라 대표 이미지·찜 여부를 채운다.
   */
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
    const pageStoreIds = page.map((s) => s.candidate.id);
    const [imagesByStore, wishlistedIds] = await Promise.all([
      this.repo.findStoreCakeImages(pageStoreIds),
      // 0n도 유효한 계정 id — truthy 체크는 0n을 비로그인으로 떨궈 undefined로만 분기한다
      accountId !== undefined
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
      hasMore: hasMoreByOffset(offset, limit, totalCount),
      rankedAt,
    };
  }
}
