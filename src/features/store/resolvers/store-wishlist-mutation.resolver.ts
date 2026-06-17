import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { StoreWishlistService } from '@/features/store/services/store-wishlist.service';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class StoreWishlistMutationResolver {
  constructor(private readonly storeWishlistService: StoreWishlistService) {}

  @Mutation('addStoreToWishlist')
  addStoreToWishlist(
    @CurrentUser() user: JwtUser,
    @Args('storeId') storeId: string,
  ): Promise<boolean> {
    return this.storeWishlistService.addStoreToWishlist(
      parseAccountId(user),
      storeId,
    );
  }

  @Mutation('removeStoreFromWishlist')
  removeStoreFromWishlist(
    @CurrentUser() user: JwtUser,
    @Args('storeId') storeId: string,
  ): Promise<boolean> {
    return this.storeWishlistService.removeStoreFromWishlist(
      parseAccountId(user),
      storeId,
    );
  }
}
