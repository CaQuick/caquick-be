import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { UserRecentViewService } from '@/features/user/services/user-recent-view.service';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserRecentViewMutationResolver {
  constructor(private readonly recentViewService: UserRecentViewService) {}

  @Mutation('recordProductView')
  recordProductView(
    @CurrentUser() user: JwtUser,
    @Args('productId') productId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.recentViewService.record(accountId, productId);
  }

  @Mutation('deleteRecentViewedProduct')
  deleteRecentViewedProduct(
    @CurrentUser() user: JwtUser,
    @Args('productId') productId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.recentViewService.deleteOne(accountId, productId);
  }

  @Mutation('clearRecentViewedProducts')
  clearRecentViewedProducts(@CurrentUser() user: JwtUser): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.recentViewService.clearAll(accountId);
  }
}
