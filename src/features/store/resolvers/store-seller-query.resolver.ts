import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { SellerDateCursorInput } from '@/features/store/dto/inputs/seller-date-cursor.input';
import { SellerFaqService } from '@/features/store/services/store-seller-faq.service';
import { SellerStoreHoursService } from '@/features/store/services/store-seller-hours.service';
import { SellerStorePolicyService } from '@/features/store/services/store-seller-policy.service';
import { SellerStoreProfileService } from '@/features/store/services/store-seller-profile.service';
import type {
  SellerFaqTopicOutput,
  SellerStoreBusinessHourOutput,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
  SellerStoreSpecialClosureOutput,
} from '@/features/store/types/store-seller-output.type';
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
    private readonly faqService: SellerFaqService,
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

  @Query('sellerFaqTopics')
  sellerFaqTopics(
    @CurrentUser() user: JwtUser,
  ): Promise<SellerFaqTopicOutput[]> {
    const accountId = parseAccountId(user);
    return this.faqService.sellerFaqTopics(accountId);
  }
}
