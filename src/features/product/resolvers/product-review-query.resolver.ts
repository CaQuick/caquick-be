import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { ReviewCommentsInput } from '@/features/product/dto/inputs/review-comments.input';
import { ProductReviewService } from '@/features/product/services/product-review.service';
import type {
  ReviewCommentConnection,
  ReviewDetail,
} from '@/features/product/types/product-review-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/** 옵셔널 인증으로 로그인 시에만 isLiked/isMine을 채운다. */
@Resolver('Query')
export class ProductReviewQueryResolver {
  constructor(private readonly service: ProductReviewService) {}

  @Query('reviewDetail')
  @UseGuards(OptionalJwtAuthGuard)
  reviewDetail(
    @Args('reviewId') reviewId: string,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<ReviewDetail> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.reviewDetail(reviewId, accountId);
  }

  @Query('reviewComments')
  @UseGuards(OptionalJwtAuthGuard)
  reviewComments(
    @Args('input') input: ReviewCommentsInput,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<ReviewCommentConnection> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.reviewComments(input, accountId);
  }
}
