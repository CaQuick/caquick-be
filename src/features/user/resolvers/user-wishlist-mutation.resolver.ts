import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { UserWishlistService } from '@/features/user/services/user-wishlist.service';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserWishlistMutationResolver {
  constructor(private readonly wishlistService: UserWishlistService) {}

  @Mutation('addToWishlist')
  addToWishlist(
    @CurrentUser() user: JwtUser,
    @Args('productId') productId: string,
  ): Promise<boolean> {
    return this.wishlistService.addToWishlist(parseAccountId(user), productId);
  }

  @Mutation('removeFromWishlist')
  removeFromWishlist(
    @CurrentUser() user: JwtUser,
    @Args('productId') productId: string,
  ): Promise<boolean> {
    return this.wishlistService.removeFromWishlist(
      parseAccountId(user),
      productId,
    );
  }
}
