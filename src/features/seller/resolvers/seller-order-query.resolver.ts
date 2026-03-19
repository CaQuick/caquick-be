import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard, type JwtUser } from '../../../global/auth';
import { SellerOrderService } from '../services/seller-order.service';
import type { SellerOrderListInput } from '../types/seller-input.type';
import type {
  SellerCursorConnection,
  SellerOrderDetailOutput,
  SellerOrderSummaryOutput,
} from '../types/seller-output.type';

import { parseAccountId, parseId } from './seller-resolver.utils';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class SellerOrderQueryResolver {
  constructor(private readonly orderService: SellerOrderService) {}

  @Query('sellerOrderList')
  sellerOrderList(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerOrderListInput,
  ): Promise<SellerCursorConnection<SellerOrderSummaryOutput>> {
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
