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
