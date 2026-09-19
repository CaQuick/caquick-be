import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { SellerCreateFaqTopicInput } from '@/features/store/dto/inputs/seller-create-faq-topic.input';
import { SellerUpdateFaqTopicInput } from '@/features/store/dto/inputs/seller-update-faq-topic.input';
import { SellerUpdatePickupPolicyInput } from '@/features/store/dto/inputs/seller-update-pickup-policy.input';
import { SellerUpdateStoreBasicInfoInput } from '@/features/store/dto/inputs/seller-update-store-basic-info.input';
import { SellerUpsertStoreBusinessHourInput } from '@/features/store/dto/inputs/seller-upsert-store-business-hour.input';
import { SellerUpsertStoreDailyCapacityInput } from '@/features/store/dto/inputs/seller-upsert-store-daily-capacity.input';
import { SellerUpsertStoreSpecialClosureInput } from '@/features/store/dto/inputs/seller-upsert-store-special-closure.input';
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

@Resolver('Mutation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class SellerStoreMutationResolver {
  constructor(
    private readonly profileService: SellerStoreProfileService,
    private readonly hoursService: SellerStoreHoursService,
    private readonly policyService: SellerStorePolicyService,
    private readonly faqService: SellerFaqService,
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

  @Mutation('sellerCreateFaqTopic')
  sellerCreateFaqTopic(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput> {
    const accountId = parseAccountId(user);
    return this.faqService.sellerCreateFaqTopic(accountId, input);
  }

  @Mutation('sellerUpdateFaqTopic')
  sellerUpdateFaqTopic(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput> {
    const accountId = parseAccountId(user);
    return this.faqService.sellerUpdateFaqTopic(accountId, input);
  }

  @Mutation('sellerDeleteFaqTopic')
  sellerDeleteFaqTopic(
    @CurrentUser() user: JwtUser,
    @Args('topicId') topicId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.faqService.sellerDeleteFaqTopic(accountId, parseId(topicId));
  }
}
