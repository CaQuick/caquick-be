import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard } from '../../../global/auth';
import type { JwtUser } from '../../../global/auth';
import { UserService } from '../user.service';

import { parseAccountId, parseId } from './user-resolver.utils';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserEngagementMutationResolver {
  constructor(private readonly userService: UserService) {}

  @Mutation('likeReview')
  likeReview(
    @CurrentUser() user: JwtUser,
    @Args('reviewId') reviewId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    const id = parseId(reviewId);
    return this.userService.likeReview(accountId, id);
  }
}
