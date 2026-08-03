import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { ProductReviewsInput } from '@/features/product/dto/inputs/product-reviews.input';
import { ReviewCommentsInput } from '@/features/product/dto/inputs/review-comments.input';
import { ProductReviewService } from '@/features/product/services/product-review.service';
import type {
  ProductReviewConnection,
  ReviewCommentConnection,
  ReviewDetail,
} from '@/features/product/types/product-review-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/**
 * 상품 공개 리뷰 조회 resolver. 비로그인도 접근 가능한 public query.
 * 옵셔널 인증으로 로그인 시에만 isLiked/isMine을 채운다.
 */
@Resolver('Query')
export class ProductReviewQueryResolver {
  constructor(private readonly service: ProductReviewService) {}

  @Query('productReviews')
  @UseGuards(OptionalJwtAuthGuard)
  productReviews(
    @Args('input') input: ProductReviewsInput,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<ProductReviewConnection> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.productReviews(input, accountId);
  }

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
