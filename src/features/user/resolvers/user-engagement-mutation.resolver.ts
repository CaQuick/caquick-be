import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { UserEngagementService } from '@/features/user/services/user-engagement.service';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserEngagementMutationResolver {
  constructor(private readonly engagementService: UserEngagementService) {}

  @Mutation('likeReview')
  likeReview(
    @CurrentUser() user: JwtUser,
    @Args('reviewId') reviewId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    const id = parseId(reviewId);
    return this.engagementService.likeReview(accountId, id);
  }
}
