import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { SellerDateCursorInput } from '@/features/seller/dto/inputs/seller-date-cursor.input';
import { SellerStoreHoursService } from '@/features/seller/services/seller-store-hours.service';
import { SellerStorePolicyService } from '@/features/seller/services/seller-store-policy.service';
import { SellerStoreProfileService } from '@/features/seller/services/seller-store-profile.service';
import type {
  SellerStoreBusinessHourOutput,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
  SellerStoreSpecialClosureOutput,
} from '@/features/seller/types/seller-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class SellerStoreQueryResolver {
  constructor(
    private readonly profileService: SellerStoreProfileService,
    private readonly hoursService: SellerStoreHoursService,
    private readonly policyService: SellerStorePolicyService,
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
    @Args('input', { nullable: true }) input?: CursorInput,
  ): Promise<CursorConnection<SellerStoreSpecialClosureOutput>> {
    const accountId = parseAccountId(user);
    return this.hoursService.sellerStoreSpecialClosures(accountId, input);
  }

  @Query('sellerStoreDailyCapacities')
  sellerStoreDailyCapacities(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerDateCursorInput,
  ): Promise<CursorConnection<SellerStoreDailyCapacityOutput>> {
    const accountId = parseAccountId(user);
    return this.policyService.sellerStoreDailyCapacities(accountId, input);
  }
}
