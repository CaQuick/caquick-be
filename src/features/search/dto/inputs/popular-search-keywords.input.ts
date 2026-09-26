import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { KEYWORD_RANK_SNAPSHOT_SIZE } from '@/features/search/constants/search.constants';

export class PopularSearchKeywordsInput {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(KEYWORD_RANK_SNAPSHOT_SIZE)
  limit?: number;
}
