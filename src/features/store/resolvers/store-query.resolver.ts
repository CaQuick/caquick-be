import { Args, Query, Resolver } from '@nestjs/graphql';

import { PopularStoresInput } from '@/features/store/dto/inputs/popular-stores.input';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import type { PopularStoreConnection } from '@/features/store/types/store-output.type';

/**
 * 매장 조회 resolver. 인기 매장 리스트는 비로그인도 접근 가능한 public query.
 */
@Resolver('Query')
export class StoreQueryResolver {
  constructor(private readonly storeListingService: StoreListingService) {}

  @Query('popularStores')
  popularStores(
    @Args('input', { nullable: true }) input?: PopularStoresInput,
  ): Promise<PopularStoreConnection> {
    return this.storeListingService.popularStores(input);
  }
}
