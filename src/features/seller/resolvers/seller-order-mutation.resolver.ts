import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { SellerOrderService } from '@/features/seller/services/seller-order.service';
import type { SellerUpdateOrderStatusInput } from '@/features/seller/types/seller-input.type';
import type { SellerOrderSummaryOutput } from '@/features/seller/types/seller-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class SellerOrderMutationResolver {
  constructor(private readonly orderService: SellerOrderService) {}

  @Mutation('sellerUpdateOrderStatus')
  sellerUpdateOrderStatus(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateOrderStatusInput,
  ): Promise<SellerOrderSummaryOutput> {
    const accountId = parseAccountId(user);
    return this.orderService.sellerUpdateOrderStatus(accountId, input);
  }
}
