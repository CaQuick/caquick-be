import { Injectable } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { DAY_MS } from '@/common/utils/kst-time';
import {
  DEFAULT_REALTIME_BEST_LIMIT,
  MAX_REALTIME_BEST_LIMIT,
  REALTIME_BEST_WINDOW_HOURS,
} from '@/features/product/constants/product-best-seller.constants';
import type { RealtimeBestCakesInput } from '@/features/product/dto/inputs/realtime-best-cakes.input';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { toPopularCake } from '@/features/product/services/product-home-mappers.helper';
import type { RealtimeBestCakesResult } from '@/features/product/types/product-best-seller-output.type';
import {
  DEFAULT_GLOBAL_RATING_PRIOR,
  RANKING_RECENT_ORDER_DAYS,
  scoreAndSortByPopularity,
} from '@/features/store';

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class ProductBestSellerService {
  constructor(
    private readonly repo: ProductRepository,
    private readonly clock: ClockService,
  ) {}

  /**
   * 검색 진입 화면 '실시간 판매 Best'. 최근 24시간 유효 주문(인기 점수와 동일 상태 집합)의
   * 수량 합 desc로 정렬하고, 동률은 인기 점수(→ 리뷰수 → id desc) 순으로 푼다(자체 판단).
   * 판매가 0인 상품은 'Best'가 아니므로 제외 — 데이터가 적으면 빈 목록이 될 수 있다(사용자 확정).
   * 호출 시점에 실시간 집계하며 rankedAt은 호출 시각이다(스냅샷 없음).
   */
  async realtimeBestCakes(
    input?: RealtimeBestCakesInput,
  ): Promise<RealtimeBestCakesResult> {
    const limit = Math.min(
      input?.limit ?? DEFAULT_REALTIME_BEST_LIMIT,
      MAX_REALTIME_BEST_LIMIT,
    );
    const rankedAt = this.clock.now();

    const candidates = await this.repo.findActiveCakesForRanking({});
    if (candidates.length === 0) return { items: [], rankedAt };

    const productIds = candidates.map((c) => c.id);
    const soldQuantities = await this.repo.aggregateProductSoldQuantities(
      productIds,
      new Date(rankedAt.getTime() - REALTIME_BEST_WINDOW_HOURS * HOUR_MS),
    );
    const sold = candidates.filter((c) => (soldQuantities.get(c.id) ?? 0) > 0);
    if (sold.length === 0) return { items: [], rankedAt };

    // 동률 해소용 인기 점수 — 판매된 상품에 대해서만 집계한다
    const soldIds = sold.map((c) => c.id);
    const since = new Date(
      rankedAt.getTime() - RANKING_RECENT_ORDER_DAYS * DAY_MS,
    );
    const [wishlistCounts, reviewStats, recentOrderCounts, globalAverage] =
      await Promise.all([
        this.repo.aggregateProductWishlistCounts(soldIds),
        this.repo.aggregateProductReviewStats(soldIds),
        this.repo.aggregateProductRecentOrderCounts(soldIds, since),
        this.repo.globalReviewAverage(),
      ]);
    const byPopularity = scoreAndSortByPopularity(
      sold,
      { wishlistCounts, reviewStats, recentOrderCounts },
      globalAverage ?? DEFAULT_GLOBAL_RATING_PRIOR,
    );

    // 인기순으로 이미 정렬된 배열을 안정 정렬(quantity desc)하면 동률 순서가 인기순으로 남는다
    const ranked = [...byPopularity].sort(
      (a, b) =>
        (soldQuantities.get(b.candidate.id) ?? 0) -
        (soldQuantities.get(a.candidate.id) ?? 0),
    );

    return {
      items: ranked
        .slice(0, limit)
        .map((entry, idx) => toPopularCake(entry.candidate, idx + 1)),
      rankedAt,
    };
  }
}
