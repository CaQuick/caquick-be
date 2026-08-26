import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { MyWishlistedStoresInput } from '@/features/store/dto/inputs/my-wishlisted-stores.input';
import { StoreWishlistService } from '@/features/store/services/store-wishlist.service';
import type { MyWishlistedStoresConnection } from '@/features/store/types/store-wishlist-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class StoreWishlistQueryResolver {
  constructor(private readonly storeWishlistService: StoreWishlistService) {}

  @Query('myWishlistedStores')
  myWishlistedStores(
    @CurrentUser() user: JwtUser,
    @Args('input') input?: MyWishlistedStoresInput,
  ): Promise<MyWishlistedStoresConnection> {
    return this.storeWishlistService.myWishlistedStores(
      parseAccountId(user),
      input,
    );
  }
}
