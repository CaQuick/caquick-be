import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CreateReviewMediaUploadUrlInput } from '@/features/user/dto/inputs/create-review-media-upload-url.input';
import { WriteReviewInput } from '@/features/user/dto/inputs/write-review.input';
import { UserReviewService } from '@/features/user/services/user-review.service';
import type {
  MyReview,
  ReviewMediaUploadUrl,
} from '@/features/user/types/user-review-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserReviewMutationResolver {
  constructor(private readonly reviewService: UserReviewService) {}

  @Mutation('writeReview')
  writeReview(
    @CurrentUser() user: JwtUser,
    @Args('input') input: WriteReviewInput,
  ): Promise<MyReview> {
    const accountId = parseAccountId(user);
    return this.reviewService.writeReview(accountId, input);
  }

  @Mutation('deleteMyReview')
  deleteMyReview(
    @CurrentUser() user: JwtUser,
    @Args('reviewId') reviewId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.reviewService.deleteMyReview(accountId, reviewId);
  }

  @Mutation('createReviewMediaUploadUrl')
  createReviewMediaUploadUrl(
    @CurrentUser() user: JwtUser,
    @Args('input') input: CreateReviewMediaUploadUrlInput,
  ): Promise<ReviewMediaUploadUrl> {
    const accountId = parseAccountId(user);
    return this.reviewService.createReviewMediaUploadUrl(accountId, input);
  }
}
