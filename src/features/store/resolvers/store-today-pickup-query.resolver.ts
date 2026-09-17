import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { TodayPickupStoresInput } from '@/features/store/dto/inputs/today-pickup-stores.input';
import { StoreTodayPickupService } from '@/features/store/services/store-today-pickup.service';
import type { TodayPickupStoreConnection } from '@/features/store/types/store-today-pickup-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/** 옵셔널 인증으로 로그인 시에만 isWishlisted를 채운다. */
@Resolver('Query')
export class StoreTodayPickupQueryResolver {
  constructor(private readonly service: StoreTodayPickupService) {}

  @Query('todayPickupStores')
  @UseGuards(OptionalJwtAuthGuard)
  todayPickupStores(
    @CurrentUser() user: JwtUser | undefined,
    @Args('input', { nullable: true }) input?: TodayPickupStoresInput,
  ): Promise<TodayPickupStoreConnection> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.todayPickupStores(input, accountId);
  }
}
