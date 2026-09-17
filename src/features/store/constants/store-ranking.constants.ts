/**
 * 점수 = w_order·ln(1+최근주문수) + w_wishlist·ln(1+찜수) + w_rating·베이지안평점.
 * 비즈니스 KPI가 확정되면 이 상수를 교체한다(추천 기본값으로 운영).
 */
export const RANKING_WEIGHTS = {
  order: 1.0,
  wishlist: 0.5,
  rating: 0.4,
} as const;

/** 리뷰가 적은 신규 매장 콜드스타트 보정(prior 가중). */
export const RANKING_BAYESIAN_M = 5;

export const RANKING_RECENT_ORDER_DAYS = 30;

export const RANKING_VALID_ORDER_STATUSES = [
  'CONFIRMED',
  'MADE',
  'PICKED_UP',
] as const;

export const DEFAULT_GLOBAL_RATING_PRIOR = 4.0;

export const DEFAULT_POPULAR_STORES_LIMIT = 20;

export const POPULAR_STORE_CAKE_IMAGE_LIMIT = 4;
