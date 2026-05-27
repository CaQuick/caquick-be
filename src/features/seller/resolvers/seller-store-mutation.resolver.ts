import { Inject, UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { SellerUpdatePickupPolicyInput } from '@/features/seller/dto/inputs/seller-update-pickup-policy.input';
import { SellerUpdateStoreBasicInfoInput } from '@/features/seller/dto/inputs/seller-update-store-basic-info.input';
import { SellerUpsertStoreBusinessHourInput } from '@/features/seller/dto/inputs/seller-upsert-store-business-hour.input';
import { SellerUpsertStoreDailyCapacityInput } from '@/features/seller/dto/inputs/seller-upsert-store-daily-capacity.input';
import { SellerUpsertStoreSpecialClosureInput } from '@/features/seller/dto/inputs/seller-upsert-store-special-closure.input';
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

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class SellerStoreMutationResolver {
  constructor(
    @Inject(SELLER_STORE_PROFILE_SERVICE)
    private readonly profileService: ISellerStoreProfileService,
    @Inject(SELLER_STORE_HOURS_SERVICE)
    private readonly hoursService: ISellerStoreHoursService,
    @Inject(SELLER_STORE_POLICY_SERVICE)
    private readonly policyService: ISellerStorePolicyService,
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
