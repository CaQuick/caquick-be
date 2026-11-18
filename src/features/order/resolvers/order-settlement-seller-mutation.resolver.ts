import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { SellerUpsertSettlementAccountInput } from '@/features/order/dto/inputs/seller-upsert-settlement-account.input';
import { SellerSettlementService } from '@/features/order/services/order-settlement-seller.service';
import type { SellerSettlementAccountOutput } from '@/features/order/types/order-payment-output.type';
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
export class SellerSettlementMutationResolver {
  constructor(private readonly settlementService: SellerSettlementService) {}

  @Mutation('sellerUpsertSettlementAccount')
  sellerUpsertSettlementAccount(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertSettlementAccountInput,
  ): Promise<SellerSettlementAccountOutput> {
    return this.settlementService.sellerUpsertSettlementAccount(
      parseAccountId(user),
      input,
    );
  }
}
