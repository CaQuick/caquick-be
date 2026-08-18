import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { DEFAULT_POPULAR_CAKES_LIMIT } from '@/features/product/constants/product-home.constants';
import type { PopularCakesInput } from '@/features/product/dto/inputs/popular-cakes.input';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import {
  toHomeBanner,
  toPopularCake,
} from '@/features/product/services/product-home-mappers.helper';
import type { PopularCakesResult } from '@/features/product/types/product-home-output.type';
import {
  DEFAULT_GLOBAL_RATING_PRIOR,
  popularityScore,
  RANKING_RECENT_ORDER_DAYS,
  type StoreMetrics,
} from '@/features/store';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ProductHomeService {
  constructor(private readonly repo: ProductRepository) {}

  /**
   * 홈 '상황별 인기 케이크' 섹션. 인기 매장과 동일 산식(최근 주문·찜·베이지안 평점)을
   * 상품 단위로 적용해 상위 카드를 뽑고, 카테고리 대표 배너를 함께 반환한다.
   * 배너는 등록분이 없으면 null(fallback 없음 — FE placeholder 처리, 정책 확정 사항).
   */
  async popularCakes(input?: PopularCakesInput): Promise<PopularCakesResult> {
    const limit = input?.limit ?? DEFAULT_POPULAR_CAKES_LIMIT;
    const categoryId =
      input?.categoryId !== undefined ? parseId(input.categoryId) : undefined;
    const regionIds = input?.regionIds?.map((id) => parseId(id));

    const rankedAt = new Date();
    const [candidates, banner] = await Promise.all([
      this.repo.findActiveCakesForRanking({ categoryId, regionIds }),
      this.repo.findHomeBanner({ categoryId, now: rankedAt }),
    ]);
    const bannerOutput = banner ? toHomeBanner(banner) : null;
    if (candidates.length === 0) {
      return { banner: bannerOutput, items: [], rankedAt };
    }

    const productIds = candidates.map((c) => c.id);
    const since = new Date(
      rankedAt.getTime() - RANKING_RECENT_ORDER_DAYS * DAY_MS,
    );

    const [wishlistCounts, reviewStats, orderCounts, globalAverage] =
      await Promise.all([
        this.repo.aggregateProductWishlistCounts(productIds),
        this.repo.aggregateProductReviewStats(productIds),
        this.repo.aggregateProductRecentOrderCounts(productIds, since),
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

    // 점수 desc → 리뷰수 desc → id desc (인기 매장과 동일한 안정적 동점 처리)
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.metrics.reviewCount !== a.metrics.reviewCount) {
        return b.metrics.reviewCount - a.metrics.reviewCount;
      }
      return b.candidate.id > a.candidate.id ? 1 : -1;
    });

    const items = scored
      .slice(0, limit)
      .map((entry, idx) => toPopularCake(entry.candidate, idx + 1));

    return { banner: bannerOutput, items, rankedAt };
  }
}
