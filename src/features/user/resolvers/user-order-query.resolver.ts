import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { UserOrderService } from '@/features/user/services/user-order.service';
import type { MyOrdersInput } from '@/features/user/types/user-order-input.type';
import type {
  MyOrderConnection,
  MyOrderDetail,
} from '@/features/user/types/user-order-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserOrderQueryResolver {
  constructor(private readonly orderService: UserOrderService) {}

  @Query('myOrders')
  myOrders(
    @CurrentUser() user: JwtUser,
    @Args('input') input?: MyOrdersInput,
  ): Promise<MyOrderConnection> {
    const accountId = parseAccountId(user);
    return this.orderService.listMyOrders(accountId, input);
  }

  @Query('myOrder')
  myOrder(
    @CurrentUser() user: JwtUser,
    @Args('orderId') orderId: string,
  ): Promise<MyOrderDetail> {
    const accountId = parseAccountId(user);
    return this.orderService.getMyOrder(accountId, parseId(orderId));
  }
}
