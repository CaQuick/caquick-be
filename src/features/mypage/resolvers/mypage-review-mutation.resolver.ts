import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CreateReviewMediaUploadUrlInput } from '@/features/mypage/dto/inputs/create-review-media-upload-url.input';
import { WriteReviewInput } from '@/features/mypage/dto/inputs/write-review.input';
import { UserReviewService } from '@/features/mypage/services/mypage-review.service';
import type { MyReview } from '@/features/mypage/types/mypage-review-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';
import type { CreateUploadUrlOutput } from '@/global/storage/types/storage.types';

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
  ): Promise<CreateUploadUrlOutput> {
    const accountId = parseAccountId(user);
    return this.reviewService.createReviewMediaUploadUrl(accountId, input);
  }
}
