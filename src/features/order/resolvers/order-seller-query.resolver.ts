import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import { SellerOrderListInput } from '@/features/order/dto/inputs/seller-order-list.input';
import { SellerOrderService } from '@/features/order/services/order-seller.service';
import type {
  SellerOrderDetailOutput,
  SellerOrderSummaryOutput,
} from '@/features/order/types/order-seller-output.type';
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
export class SellerOrderQueryResolver {
  constructor(private readonly orderService: SellerOrderService) {}

  @Query('sellerOrderList')
  sellerOrderList(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerOrderListInput,
  ): Promise<CursorConnection<SellerOrderSummaryOutput>> {
    const accountId = parseAccountId(user);
    return this.orderService.sellerOrderList(accountId, input);
  }

  @Query('sellerOrder')
  sellerOrder(
    @CurrentUser() user: JwtUser,
    @Args('orderId') orderId: string,
  ): Promise<SellerOrderDetailOutput> {
    const accountId = parseAccountId(user);
    return this.orderService.sellerOrder(accountId, parseId(orderId));
  }
}
