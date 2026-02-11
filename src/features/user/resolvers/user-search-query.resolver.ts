import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard } from '../../../global/auth';
import type { JwtUser } from '../../../global/auth';
import type { MySearchHistoriesInput } from '../types/user-input.type';
import type { SearchHistoryConnection } from '../types/user-output.type';
import { UserService } from '../user.service';

import { parseAccountId } from './user-resolver.utils';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserSearchQueryResolver {
  constructor(private readonly userService: UserService) {}

  @Query('mySearchHistories')
  mySearchHistories(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: MySearchHistoriesInput,
  ): Promise<SearchHistoryConnection> {
    const accountId = parseAccountId(user);
    return this.userService.mySearchHistories(accountId, input);
  }
}
