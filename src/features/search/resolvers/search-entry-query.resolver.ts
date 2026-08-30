import { Args, Query, Resolver } from '@nestjs/graphql';

import { PopularSearchKeywordsInput } from '@/features/search/dto/inputs/popular-search-keywords.input';
import { SearchKeywordRankService } from '@/features/search/services/search-keyword-rank.service';
import type { PopularSearchKeywordsResult } from '@/features/search/types/search-entry-output.type';

/**
 * 검색 진입 화면 조회 resolver. 개인화 필드가 없는 public query(인증 불필요).
 */
@Resolver('Query')
export class SearchEntryQueryResolver {
  constructor(private readonly rankService: SearchKeywordRankService) {}

  @Query('popularSearchKeywords')
  popularSearchKeywords(
    @Args('input', { nullable: true }) input?: PopularSearchKeywordsInput,
  ): Promise<PopularSearchKeywordsResult> {
    return this.rankService.popularSearchKeywords(input);
  }
}
