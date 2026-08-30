import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { MAX_POPULAR_KEYWORDS_LIMIT } from '@/features/search/constants/search.constants';

export class PopularSearchKeywordsInput {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_POPULAR_KEYWORDS_LIMIT)
  limit?: number;
}
