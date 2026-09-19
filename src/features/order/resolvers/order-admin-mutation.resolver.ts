import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminCancelOrderInput } from '@/features/order/dto/inputs/admin-cancel-order.input';
import { AdminOrderService } from '@/features/order/services/order-admin.service';
import type { AdminOrderSummaryOutput } from '@/features/order/types/order-admin-output.type';
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
@Roles('ADMIN')
export class AdminOrderMutationResolver {
  constructor(private readonly orderService: AdminOrderService) {}

  @Mutation('adminCancelOrder')
  adminCancelOrder(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminCancelOrderInput,
  ): Promise<AdminOrderSummaryOutput> {
    return this.orderService.adminCancelOrder(parseAccountId(user), input);
  }
}
