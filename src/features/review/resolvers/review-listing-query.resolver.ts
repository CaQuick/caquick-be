import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { ProductReviewsInput } from '@/features/review/dto/inputs/product-reviews.input';
import { StoreReviewsInput } from '@/features/review/dto/inputs/store-reviews.input';
import { ReviewListingService } from '@/features/review/services/review-listing.service';
import type {
  ProductReviewConnection,
  StoreReviewConnection,
} from '@/features/review/types/review-listing-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/** 옵셔널 인증으로 로그인 시에만 isLiked를 채운다. */
@Resolver('Query')
export class ReviewListingQueryResolver {
  constructor(private readonly service: ReviewListingService) {}

  @Query('productReviews')
  @UseGuards(OptionalJwtAuthGuard)
  productReviews(
    @Args('input') input: ProductReviewsInput,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<ProductReviewConnection> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.productReviews(input, accountId);
  }

  @Query('storeReviews')
  @UseGuards(OptionalJwtAuthGuard)
  storeReviews(
    @Args('input') input: StoreReviewsInput,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<StoreReviewConnection> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.storeReviews(input, accountId);
  }
}
