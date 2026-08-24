import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CreateOrderInput } from '@/features/order/dto/inputs/create-order.input';
import { OrderCheckoutService } from '@/features/order/services/order-checkout.service';
import type { CreateOrderOutput } from '@/features/order/types/create-order-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/** 주문 생성 resolver. 검증·가격 계산은 OrderCheckoutService 담당. */
@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class OrderCheckoutMutationResolver {
  constructor(private readonly checkoutService: OrderCheckoutService) {}

  @Mutation('createOrder')
  createOrder(
    @CurrentUser() user: JwtUser,
    @Args('input') input: CreateOrderInput,
  ): Promise<CreateOrderOutput> {
    return this.checkoutService.createOrder(parseAccountId(user), input);
  }
}
