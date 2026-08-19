import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { MyReviewableOrderItemsInput } from '@/features/user/dto/inputs/my-reviewable-order-items.input';
import { MyReviewsInput } from '@/features/user/dto/inputs/my-reviews.input';
import { UserReviewService } from '@/features/user/services/user-review.service';
import type {
  MyReviewableOrderItemConnection,
  MyReviewConnection,
  MyReviewOrNull,
} from '@/features/user/types/user-review-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserReviewQueryResolver {
  constructor(private readonly reviewService: UserReviewService) {}

  @Query('myReviews')
  myReviews(
    @CurrentUser() user: JwtUser,
    @Args('input') input?: MyReviewsInput,
  ): Promise<MyReviewConnection> {
    const accountId = parseAccountId(user);
    return this.reviewService.myReviews(accountId, input);
  }

  @Query('myReviewableOrderItems')
  myReviewableOrderItems(
    @CurrentUser() user: JwtUser,
    @Args('input') input?: MyReviewableOrderItemsInput,
  ): Promise<MyReviewableOrderItemConnection> {
    const accountId = parseAccountId(user);
    return this.reviewService.myReviewableOrderItems(accountId, input);
  }

  @Query('myReviewForOrderItem')
  myReviewForOrderItem(
    @CurrentUser() user: JwtUser,
    @Args('orderItemId') orderItemId: string,
  ): Promise<MyReviewOrNull> {
    const accountId = parseAccountId(user);
    return this.reviewService.myReviewForOrderItem(accountId, orderItemId);
  }
}
