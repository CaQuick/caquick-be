/**
 * 인기 매장 랭킹 점수 파라미터.
 *
 * 점수 = w_order·ln(1+최근주문수) + w_wishlist·ln(1+찜수) + w_rating·베이지안평점
 * 비즈니스 KPI가 확정되면 이 상수를 교체한다(추천 기본값으로 운영).
 */
export const RANKING_WEIGHTS = {
  order: 1.0,
  wishlist: 0.5,
  rating: 0.4,
} as const;

/** 베이지안 평점 신뢰 임계 리뷰수(prior 가중). 리뷰가 적은 신규 매장 콜드스타트 보정. */
export const RANKING_BAYESIAN_M = 5;

/** 최근 주문 집계 기간(일). */
export const RANKING_RECENT_ORDER_DAYS = 30;

/** 인기 점수 가중에 포함되는 유효 주문 상태. */
export const RANKING_VALID_ORDER_STATUSES = [
  'CONFIRMED',
  'MADE',
  'PICKED_UP',
] as const;

/** 전체 리뷰가 전무할 때 베이지안 prior로 사용할 기본 평점. */
export const DEFAULT_GLOBAL_RATING_PRIOR = 4.0;

/** popularStores 기본 페이지 크기. */
export const DEFAULT_POPULAR_STORES_LIMIT = 20;

/** 매장 카드에 노출할 대표 케이크 이미지 최대 장수. */
export const POPULAR_STORE_CAKE_IMAGE_LIMIT = 4;
