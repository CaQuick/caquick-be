import type { PopularCake } from '@/features/product/types/product-home-output.type';

/** realtimeBestCakes 결과(SDL search-entry.graphql RealtimeBestCakesResult). */
export interface RealtimeBestCakesResult {
  items: PopularCake[];
  /** 집계 기준 시각(호출 시점). 화면의 'HH:mm 기준' 표기. */
  rankedAt: Date;
}
