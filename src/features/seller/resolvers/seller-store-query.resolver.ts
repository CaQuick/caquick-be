import { Inject, UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { SellerCursorInput } from '@/features/seller/dto/inputs/seller-cursor.input';
import { SellerDateCursorInput } from '@/features/seller/dto/inputs/seller-date-cursor.input';
import {
  SELLER_STORE_HOURS_SERVICE,
  type ISellerStoreHoursService,
} from '@/features/seller/services/seller-store-hours.service.interface';
import {
  SELLER_STORE_POLICY_SERVICE,
  type ISellerStorePolicyService,
} from '@/features/seller/services/seller-store-policy.service.interface';
import {
  SELLER_STORE_PROFILE_SERVICE,
  type ISellerStoreProfileService,
} from '@/features/seller/services/seller-store-profile.service.interface';
import type {
  SellerCursorConnection,
  SellerStoreBusinessHourOutput,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
  SellerStoreSpecialClosureOutput,
} from '@/features/seller/types/seller-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class SellerStoreQueryResolver {
  constructor(
    @Inject(SELLER_STORE_PROFILE_SERVICE)
    private readonly profileService: ISellerStoreProfileService,
    @Inject(SELLER_STORE_HOURS_SERVICE)
    private readonly hoursService: ISellerStoreHoursService,
    @Inject(SELLER_STORE_POLICY_SERVICE)
    private readonly policyService: ISellerStorePolicyService,
  ) {}

  @Query('sellerMyStore')
  sellerMyStore(@CurrentUser() user: JwtUser): Promise<SellerStoreOutput> {
    const accountId = parseAccountId(user);
    return this.profileService.sellerMyStore(accountId);
  }

  @Query('sellerStoreBusinessHours')
  sellerStoreBusinessHours(
    @CurrentUser() user: JwtUser,
  ): Promise<SellerStoreBusinessHourOutput[]> {
    const accountId = parseAccountId(user);
    return this.hoursService.sellerStoreBusinessHours(accountId);
  }

  @Query('sellerStoreSpecialClosures')
  sellerStoreSpecialClosures(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerStoreSpecialClosureOutput>> {
    const accountId = parseAccountId(user);
    return this.hoursService.sellerStoreSpecialClosures(accountId, input);
  }

  @Query('sellerStoreDailyCapacities')
  sellerStoreDailyCapacities(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerDateCursorInput,
  ): Promise<SellerCursorConnection<SellerStoreDailyCapacityOutput>> {
    const accountId = parseAccountId(user);
    return this.policyService.sellerStoreDailyCapacities(accountId, input);
  }
}
