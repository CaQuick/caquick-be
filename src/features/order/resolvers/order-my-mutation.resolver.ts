import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { CancelMyOrderInput } from '@/features/order/dto/inputs/cancel-my-order.input';
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

  @Mutation('cancelMyOrder')
  cancelMyOrder(
    @CurrentUser() user: JwtUser,
    @Args('input') input: CancelMyOrderInput,
  ): Promise<MyOrderDetail> {
    return this.orderService.cancelMyOrder(parseAccountId(user), input);
  }
}
