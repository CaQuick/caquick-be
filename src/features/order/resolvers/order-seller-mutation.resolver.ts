import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { SellerUpdateOrderStatusInput } from '@/features/order/dto/inputs/seller-update-order-status.input';
import { SellerOrderService } from '@/features/order/services/order-seller.service';
import type { SellerOrderSummaryOutput } from '@/features/order/types/order-seller-output.type';
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
