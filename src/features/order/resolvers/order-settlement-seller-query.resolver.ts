import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';

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

@Resolver('Query')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class SellerSettlementQueryResolver {
  constructor(private readonly settlementService: SellerSettlementService) {}

  @Query('sellerSettlementAccount')
  sellerSettlementAccount(
    @CurrentUser() user: JwtUser,
  ): Promise<SellerSettlementAccountOutput | null> {
    return this.settlementService.sellerSettlementAccount(parseAccountId(user));
  }
}
