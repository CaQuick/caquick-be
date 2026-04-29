import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { UserWishlistService } from '@/features/user/services/user-wishlist.service';
import type {
  MyWishlistConnection,
  MyWishlistInput,
} from '@/features/user/types/user-wishlist-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserWishlistQueryResolver {
  constructor(private readonly wishlistService: UserWishlistService) {}

  @Query('myWishlist')
  myWishlist(
    @CurrentUser() user: JwtUser,
    @Args('input') input?: MyWishlistInput,
  ): Promise<MyWishlistConnection> {
    return this.wishlistService.myWishlist(parseAccountId(user), input);
  }
}
