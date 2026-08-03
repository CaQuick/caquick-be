import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { WriteReviewCommentInput } from '@/features/user/dto/inputs/write-review-comment.input';
import { UserEngagementService } from '@/features/user/services/user-engagement.service';
import type { MyReviewComment } from '@/features/user/types/user-review-output.type';
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

  @Mutation('unlikeReview')
  unlikeReview(
    @CurrentUser() user: JwtUser,
    @Args('reviewId') reviewId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    const id = parseId(reviewId);
    return this.engagementService.unlikeReview(accountId, id);
  }

  @Mutation('writeReviewComment')
  writeReviewComment(
    @CurrentUser() user: JwtUser,
    @Args('input') input: WriteReviewCommentInput,
  ): Promise<MyReviewComment> {
    const accountId = parseAccountId(user);
    return this.engagementService.writeReviewComment(accountId, input);
  }

  @Mutation('deleteMyReviewComment')
  deleteMyReviewComment(
    @CurrentUser() user: JwtUser,
    @Args('commentId') commentId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    const id = parseId(commentId);
    return this.engagementService.deleteMyReviewComment(accountId, id);
  }
}
