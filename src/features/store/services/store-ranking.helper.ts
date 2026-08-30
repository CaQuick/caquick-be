import {
  RANKING_BAYESIAN_M,
  RANKING_WEIGHTS,
} from '@/features/store/constants/store-ranking.constants';

export interface StoreMetrics {
  recentOrderCount: number;
  wishlistCount: number;
  ratingAverage: number;
  reviewCount: number;
}

/**
 * 베이지안 평점: 리뷰 수가 적을수록 전체 평균(globalAvg)으로 수축시켜
 * 신규/소량 리뷰 매장이 과대평가되는 것을 막는다.
 */
export function bayesianRating(
  average: number,
  count: number,
  globalAverage: number,
  m: number = RANKING_BAYESIAN_M,
): number {
  if (count <= 0) return globalAverage;
  return (count / (count + m)) * average + (m / (count + m)) * globalAverage;
}

/**
 * 인기 점수. 주문/찜은 ln 으로 롱테일을 완화하고, 평점은 베이지안 보정 후 가중 합산.
 */
export function popularityScore(
  metrics: StoreMetrics,
  globalAverage: number,
): number {
  const bayes = bayesianRating(
    metrics.ratingAverage,
    metrics.reviewCount,
    globalAverage,
  );
  return (
    RANKING_WEIGHTS.order * Math.log1p(metrics.recentOrderCount) +
    RANKING_WEIGHTS.wishlist * Math.log1p(metrics.wishlistCount) +
    RANKING_WEIGHTS.rating * bayes
  );
}

/** 후보별 집계값 묶음(후보 id 키 Map). */
export interface PopularityAggregates {
  wishlistCounts: Map<bigint, number>;
  reviewStats: Map<bigint, { average: number; count: number }>;
  recentOrderCounts: Map<bigint, number>;
}

export interface ScoredCandidate<T> {
  candidate: T;
  metrics: StoreMetrics;
  score: number;
}

/**
 * 후보 목록을 인기 점수화하고 점수 desc → 리뷰수 desc → id desc로 정렬한다
 * (안정적 동점 처리). 인기 매장·인기 케이크가 동일 정책을 공유한다(이슈 #226).
 */
export function scoreAndSortByPopularity<T extends { id: bigint }>(
  candidates: T[],
  aggregates: PopularityAggregates,
  globalAverage: number,
): ScoredCandidate<T>[] {
  const scored = candidates.map((candidate) => {
    const review = aggregates.reviewStats.get(candidate.id);
    const metrics: StoreMetrics = {
      recentOrderCount: aggregates.recentOrderCounts.get(candidate.id) ?? 0,
      wishlistCount: aggregates.wishlistCounts.get(candidate.id) ?? 0,
      ratingAverage: review?.average ?? 0,
      reviewCount: review?.count ?? 0,
    };
    return {
      candidate,
      metrics,
      score: popularityScore(metrics, globalAverage),
    };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.metrics.reviewCount !== a.metrics.reviewCount) {
      return b.metrics.reviewCount - a.metrics.reviewCount;
    }
    return b.candidate.id > a.candidate.id ? 1 : -1;
  });
  return scored;
}
