import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import { SellerSettlementListInput } from '@/features/order/dto/inputs/seller-settlement-list.input';
import { SellerSettlementService } from '@/features/order/services/order-settlement-seller.service';
import type { SellerSettlementAccountOutput } from '@/features/order/types/order-payment-output.type';
import type {
  SellerSettlementDetailOutput,
  SellerSettlementSummaryOutput,
} from '@/features/order/types/order-settlement-output.type';
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

  @Query('sellerSettlements')
  sellerSettlements(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerSettlementListInput,
  ): Promise<CursorConnection<SellerSettlementSummaryOutput>> {
    return this.settlementService.sellerSettlements(
      parseAccountId(user),
      input,
    );
  }

  @Query('sellerSettlement')
  sellerSettlement(
    @CurrentUser() user: JwtUser,
    @Args('settlementId') settlementId: string,
  ): Promise<SellerSettlementDetailOutput> {
    return this.settlementService.sellerSettlement(
      parseAccountId(user),
      parseId(settlementId),
    );
  }
}
