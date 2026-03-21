import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { UserSearchService } from '@/features/user/services/user-search.service';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserSearchMutationResolver {
  constructor(private readonly searchService: UserSearchService) {}

  @Mutation('deleteSearchHistory')
  deleteSearchHistory(
    @CurrentUser() user: JwtUser,
    @Args('id') id: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    const parsedId = parseId(id);
    return this.searchService.deleteSearchHistory(accountId, parsedId);
  }

  @Mutation('clearSearchHistories')
  clearSearchHistories(@CurrentUser() user: JwtUser): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.searchService.clearSearchHistories(accountId);
  }
}
