import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { SearchStoresInput } from '@/features/store/dto/inputs/search-stores.input';
import { StoreSearchService } from '@/features/store/services/store-search.service';
import type { SearchStoreConnection } from '@/features/store/types/store-search-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/** 옵셔널 인증으로 로그인 시에만 isWishlisted를 채운다. */
@Resolver('Query')
export class StoreSearchQueryResolver {
  constructor(private readonly service: StoreSearchService) {}

  @Query('searchStores')
  @UseGuards(OptionalJwtAuthGuard)
  searchStores(
    @Args('input') input: SearchStoresInput,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<SearchStoreConnection> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.searchStores(input, accountId);
  }
}
