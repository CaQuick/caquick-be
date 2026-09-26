import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { StoreDetailService } from '@/features/store/services/store-detail.service';
import type { StoreDetail } from '@/features/store/types/store-detail-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/** 옵셔널 인증으로 로그인 시에만 isWishlisted를 채운다. */
@Resolver('Query')
export class StoreDetailQueryResolver {
  constructor(private readonly storeDetailService: StoreDetailService) {}

  @Query('storeDetail')
  @UseGuards(OptionalJwtAuthGuard)
  storeDetail(
    @Args('storeId') storeId: string,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<StoreDetail> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.storeDetailService.storeDetail(storeId, accountId);
  }
}
