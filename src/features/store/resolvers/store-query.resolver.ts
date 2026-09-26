import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { PopularStoresInput } from '@/features/store/dto/inputs/popular-stores.input';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import type { PopularStoreConnection } from '@/features/store/types/store-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/** 옵셔널 인증으로 로그인 시에만 isWishlisted를 채운다. */
@Resolver('Query')
export class StoreQueryResolver {
  constructor(private readonly storeListingService: StoreListingService) {}

  @Query('popularStores')
  @UseGuards(OptionalJwtAuthGuard)
  popularStores(
    @CurrentUser() user: JwtUser | undefined,
    @Args('input', { nullable: true }) input?: PopularStoresInput,
  ): Promise<PopularStoreConnection> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.storeListingService.popularStores(input, accountId);
  }
}
