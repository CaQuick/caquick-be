import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { MyWishlistStoreGroupsInput } from '@/features/user/dto/inputs/my-wishlist-store-groups.input';
import { MyWishlistInput } from '@/features/user/dto/inputs/my-wishlist.input';
import { UserWishlistService } from '@/features/user/services/user-wishlist.service';
import type {
  MyWishlistConnection,
  MyWishlistStoreGroupsConnection,
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

  @Query('myWishlistStoreGroups')
  myWishlistStoreGroups(
    @CurrentUser() user: JwtUser,
    @Args('input') input?: MyWishlistStoreGroupsInput,
  ): Promise<MyWishlistStoreGroupsConnection> {
    return this.wishlistService.myWishlistStoreGroups(
      parseAccountId(user),
      input,
    );
  }
}
