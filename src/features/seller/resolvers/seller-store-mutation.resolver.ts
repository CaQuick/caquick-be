import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard, type JwtUser } from '../../../global/auth';
import { SellerStoreService } from '../services/seller-store.service';
import type {
  SellerUpdatePickupPolicyInput,
  SellerUpdateStoreBasicInfoInput,
  SellerUpsertStoreBusinessHourInput,
  SellerUpsertStoreDailyCapacityInput,
  SellerUpsertStoreSpecialClosureInput,
} from '../types/seller-input.type';
import type {
  SellerStoreBusinessHourOutput,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
  SellerStoreSpecialClosureOutput,
} from '../types/seller-output.type';

import { parseAccountId, parseId } from './seller-resolver.utils';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class SellerStoreMutationResolver {
  constructor(private readonly storeService: SellerStoreService) {}

  @Mutation('sellerUpdateStoreBasicInfo')
  sellerUpdateStoreBasicInfo(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateStoreBasicInfoInput,
  ): Promise<SellerStoreOutput> {
    const accountId = parseAccountId(user);
    return this.storeService.sellerUpdateStoreBasicInfo(accountId, input);
  }

  @Mutation('sellerUpsertStoreBusinessHour')
  sellerUpsertStoreBusinessHour(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertStoreBusinessHourInput,
  ): Promise<SellerStoreBusinessHourOutput> {
    const accountId = parseAccountId(user);
    return this.storeService.sellerUpsertStoreBusinessHour(accountId, input);
  }

  @Mutation('sellerUpsertStoreSpecialClosure')
  sellerUpsertStoreSpecialClosure(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertStoreSpecialClosureInput,
  ): Promise<SellerStoreSpecialClosureOutput> {
    const accountId = parseAccountId(user);
    return this.storeService.sellerUpsertStoreSpecialClosure(accountId, input);
  }

  @Mutation('sellerDeleteStoreSpecialClosure')
  sellerDeleteStoreSpecialClosure(
    @CurrentUser() user: JwtUser,
    @Args('closureId') closureId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.storeService.sellerDeleteStoreSpecialClosure(
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
    return this.storeService.sellerUpdatePickupPolicy(accountId, input);
  }

  @Mutation('sellerUpsertStoreDailyCapacity')
  sellerUpsertStoreDailyCapacity(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertStoreDailyCapacityInput,
  ): Promise<SellerStoreDailyCapacityOutput> {
    const accountId = parseAccountId(user);
    return this.storeService.sellerUpsertStoreDailyCapacity(accountId, input);
  }

  @Mutation('sellerDeleteStoreDailyCapacity')
  sellerDeleteStoreDailyCapacity(
    @CurrentUser() user: JwtUser,
    @Args('capacityId') capacityId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.storeService.sellerDeleteStoreDailyCapacity(
      accountId,
      parseId(capacityId),
    );
  }
}
