import type { PopularCake } from '@/features/product/types/product-home-output.type';

export interface RealtimeBestCakesResult {
  items: PopularCake[];
  rankedAt: Date;
}
