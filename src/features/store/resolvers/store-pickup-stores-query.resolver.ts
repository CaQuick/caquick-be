import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { PickupStoresInput } from '@/features/store/dto/inputs/pickup-stores.input';
import { StorePickupStoresService } from '@/features/store/services/store-pickup-stores.service';
import type { PickupStoreConnection } from '@/features/store/types/store-pickup-stores-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/** 옵셔널 인증으로 로그인 시에만 isWishlisted를 채운다. */
@Resolver('Query')
export class StorePickupStoresQueryResolver {
  constructor(private readonly service: StorePickupStoresService) {}

  @Query('pickupStores')
  @UseGuards(OptionalJwtAuthGuard)
  pickupStores(
    @CurrentUser() user: JwtUser | undefined,
    @Args('input') input: PickupStoresInput,
  ): Promise<PickupStoreConnection> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.pickupStores(input, accountId);
  }
}
