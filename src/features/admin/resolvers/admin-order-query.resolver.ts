import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { AdminOrderListInput } from '@/features/admin/dto/inputs/admin-order-list.input';
import { AdminOrderService } from '@/features/admin/services/admin-order.service';
import type {
  AdminCursorConnection,
  AdminOrderDetailOutput,
  AdminOrderSummaryOutput,
} from '@/features/admin/types/admin-output.type';
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
@Roles('ADMIN')
export class AdminOrderQueryResolver {
  constructor(private readonly orderService: AdminOrderService) {}

  @Query('adminOrders')
  adminOrders(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminOrderListInput,
  ): Promise<AdminCursorConnection<AdminOrderSummaryOutput>> {
    return this.orderService.adminOrders(parseAccountId(user), input);
  }

  @Query('adminOrder')
  adminOrder(
    @CurrentUser() user: JwtUser,
    @Args('orderId') orderId: string,
  ): Promise<AdminOrderDetailOutput> {
    return this.orderService.adminOrder(parseAccountId(user), parseId(orderId));
  }
}
