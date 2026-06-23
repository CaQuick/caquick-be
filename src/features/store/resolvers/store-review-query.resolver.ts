import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { StoreReviewsInput } from '@/features/store/dto/inputs/store-reviews.input';
import { StoreReviewService } from '@/features/store/services/store-review.service';
import type { StoreReviewConnection } from '@/features/store/types/store-review-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/**
 * 매장 공개 리뷰 조회 resolver. 비로그인도 접근 가능한 public query.
 * 옵셔널 인증으로 로그인 시에만 isLiked를 채운다.
 */
@Resolver('Query')
export class StoreReviewQueryResolver {
  constructor(private readonly storeReviewService: StoreReviewService) {}

  @Query('storeReviews')
  @UseGuards(OptionalJwtAuthGuard)
  storeReviews(
    @Args('input') input: StoreReviewsInput,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<StoreReviewConnection> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.storeReviewService.storeReviews(input, accountId);
  }
}
