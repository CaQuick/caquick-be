import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '../../../global/auth';
import { UserSearchService } from '../services/user-search.service';
import type { MySearchHistoriesInput } from '../types/user-input.type';
import type { SearchHistoryConnection } from '../types/user-output.type';

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
