import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '../../../global/auth';
import { SellerStoreService } from '../services/seller-store.service';
import type {
  SellerCursorInput,
  SellerDateCursorInput,
} from '../types/seller-input.type';
import type {
  SellerCursorConnection,
  SellerStoreBusinessHourOutput,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
  SellerStoreSpecialClosureOutput,
} from '../types/seller-output.type';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class SellerStoreQueryResolver {
  constructor(private readonly storeService: SellerStoreService) {}

  @Query('sellerMyStore')
  sellerMyStore(@CurrentUser() user: JwtUser): Promise<SellerStoreOutput> {
    const accountId = parseAccountId(user);
    return this.storeService.sellerMyStore(accountId);
  }

  @Query('sellerStoreBusinessHours')
  sellerStoreBusinessHours(
    @CurrentUser() user: JwtUser,
  ): Promise<SellerStoreBusinessHourOutput[]> {
    const accountId = parseAccountId(user);
    return this.storeService.sellerStoreBusinessHours(accountId);
  }

  @Query('sellerStoreSpecialClosures')
  sellerStoreSpecialClosures(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerStoreSpecialClosureOutput>> {
    const accountId = parseAccountId(user);
    return this.storeService.sellerStoreSpecialClosures(accountId, input);
  }

  @Query('sellerStoreDailyCapacities')
  sellerStoreDailyCapacities(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerDateCursorInput,
  ): Promise<SellerCursorConnection<SellerStoreDailyCapacityOutput>> {
    const accountId = parseAccountId(user);
    return this.storeService.sellerStoreDailyCapacities(accountId, input);
  }
}
