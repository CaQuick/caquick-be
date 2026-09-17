import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import {
  type HomeBanner,
  ProductBestSellerService,
  RealtimeBestCakesInput,
  type RealtimeBestCakesResult,
} from '@/features/product';
import { PopularSearchKeywordsInput } from '@/features/search/dto/inputs/popular-search-keywords.input';
import { SearchEntryService } from '@/features/search/services/search-entry.service';
import { SearchKeywordRankService } from '@/features/search/services/search-keyword-rank.service';
import type { PopularSearchKeywordsResult } from '@/features/search/types/search-entry-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/**
 * 검색 진입 화면 조회 resolver. 개인화 필드가 없는 public query(인증 불필요).
 */
@Resolver('Query')
export class SearchEntryQueryResolver {
  constructor(
    private readonly rankService: SearchKeywordRankService,
    private readonly entryService: SearchEntryService,
    private readonly bestSellerService: ProductBestSellerService,
  ) {}

  @Query('popularSearchKeywords')
  popularSearchKeywords(
    @Args('input', { nullable: true }) input?: PopularSearchKeywordsInput,
  ): Promise<PopularSearchKeywordsResult> {
    return this.rankService.popularSearchKeywords(input);
  }

  @Query('realtimeBestCakes')
  @UseGuards(OptionalJwtAuthGuard)
  realtimeBestCakes(
    @Args('input', { nullable: true })
    input: RealtimeBestCakesInput | undefined,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<RealtimeBestCakesResult> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.bestSellerService.realtimeBestCakes(input, accountId);
  }

  @Query('searchBanner')
  searchBanner(): Promise<HomeBanner | null> {
    return this.entryService.searchBanner();
  }
}
