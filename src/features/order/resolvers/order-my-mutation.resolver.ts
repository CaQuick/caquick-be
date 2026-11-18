import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { UserOrderService } from '@/features/order/services/order-my.service';
import type { MyOrderDetail } from '@/features/order/types/order-my-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserOrderMutationResolver {
  constructor(private readonly orderService: UserOrderService) {}

  @Mutation('markMyOrderDepositSent')
  markMyOrderDepositSent(
    @CurrentUser() user: JwtUser,
    @Args('orderId') orderId: string,
  ): Promise<MyOrderDetail> {
    return this.orderService.markMyOrderDepositSent(
      parseAccountId(user),
      parseId(orderId),
    );
  }
}
