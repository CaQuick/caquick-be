import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { MAX_REALTIME_BEST_LIMIT } from '@/features/product/constants/product-best-seller.constants';

export class RealtimeBestCakesInput {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_REALTIME_BEST_LIMIT)
  limit?: number;
}
