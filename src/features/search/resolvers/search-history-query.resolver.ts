import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { MySearchHistoriesInput } from '@/features/search/dto/inputs/my-search-histories.input';
import { UserSearchService } from '@/features/search/services/search-history.service';
import type { SearchHistoryConnection } from '@/features/search/types/search-history-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserSearchQueryResolver {
  constructor(private readonly searchService: UserSearchService) {}

  @Query('mySearchHistories')
  mySearchHistories(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: MySearchHistoriesInput,
  ): Promise<SearchHistoryConnection> {
    const accountId = parseAccountId(user);
    return this.searchService.mySearchHistories(accountId, input);
  }
}
