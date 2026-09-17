import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { SellerUpdatePickupPolicyInput } from '@/features/seller/dto/inputs/seller-update-pickup-policy.input';
import { SellerUpdateStoreBasicInfoInput } from '@/features/seller/dto/inputs/seller-update-store-basic-info.input';
import { SellerUpsertStoreBusinessHourInput } from '@/features/seller/dto/inputs/seller-upsert-store-business-hour.input';
import { SellerUpsertStoreDailyCapacityInput } from '@/features/seller/dto/inputs/seller-upsert-store-daily-capacity.input';
import { SellerUpsertStoreSpecialClosureInput } from '@/features/seller/dto/inputs/seller-upsert-store-special-closure.input';
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

@Resolver('Mutation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class SellerStoreMutationResolver {
  constructor(
    private readonly profileService: SellerStoreProfileService,
    private readonly hoursService: SellerStoreHoursService,
    private readonly policyService: SellerStorePolicyService,
  ) {}

  @Mutation('sellerUpdateStoreBasicInfo')
  sellerUpdateStoreBasicInfo(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateStoreBasicInfoInput,
  ): Promise<SellerStoreOutput> {
    const accountId = parseAccountId(user);
    return this.profileService.sellerUpdateStoreBasicInfo(accountId, input);
  }

  @Mutation('sellerUpsertStoreBusinessHour')
  sellerUpsertStoreBusinessHour(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertStoreBusinessHourInput,
  ): Promise<SellerStoreBusinessHourOutput> {
    const accountId = parseAccountId(user);
    return this.hoursService.sellerUpsertStoreBusinessHour(accountId, input);
  }

  @Mutation('sellerUpsertStoreSpecialClosure')
  sellerUpsertStoreSpecialClosure(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertStoreSpecialClosureInput,
  ): Promise<SellerStoreSpecialClosureOutput> {
    const accountId = parseAccountId(user);
    return this.hoursService.sellerUpsertStoreSpecialClosure(accountId, input);
  }

  @Mutation('sellerDeleteStoreSpecialClosure')
  sellerDeleteStoreSpecialClosure(
    @CurrentUser() user: JwtUser,
    @Args('closureId') closureId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.hoursService.sellerDeleteStoreSpecialClosure(
      accountId,
      parseId(closureId),
    );
  }

  @Mutation('sellerUpdatePickupPolicy')
  sellerUpdatePickupPolicy(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdatePickupPolicyInput,
  ): Promise<SellerStoreOutput> {
    const accountId = parseAccountId(user);
    return this.policyService.sellerUpdatePickupPolicy(accountId, input);
  }

  @Mutation('sellerUpsertStoreDailyCapacity')
  sellerUpsertStoreDailyCapacity(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertStoreDailyCapacityInput,
  ): Promise<SellerStoreDailyCapacityOutput> {
    const accountId = parseAccountId(user);
    return this.policyService.sellerUpsertStoreDailyCapacity(accountId, input);
  }

  @Mutation('sellerDeleteStoreDailyCapacity')
  sellerDeleteStoreDailyCapacity(
    @CurrentUser() user: JwtUser,
    @Args('capacityId') capacityId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.policyService.sellerDeleteStoreDailyCapacity(
      accountId,
      parseId(capacityId),
    );
  }
}
