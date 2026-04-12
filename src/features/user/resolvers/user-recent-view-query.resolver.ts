import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { UserRecentViewService } from '@/features/user/services/user-recent-view.service';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserRecentViewQueryResolver {
  constructor(private readonly recentViewService: UserRecentViewService) {}

  @Query('myRecentViewedProducts')
  myRecentViewedProducts(
    @CurrentUser() user: JwtUser,
    @Args('input') input?: { offset?: number; limit?: number },
  ) {
    const accountId = parseAccountId(user);
    return this.recentViewService.list(accountId, input);
  }
}
