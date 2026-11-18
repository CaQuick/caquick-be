import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CreateOrderInput } from '@/features/order/dto/inputs/create-order.input';
import { OrderCheckoutService } from '@/features/order/services/order-checkout.service';
import type { CreateOrderOutput } from '@/features/order/types/create-order-output.type';
import type { OrderCustomUploadPurpose } from '@/generated/prisma/client';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';
import type { CreateUploadUrlOutput } from '@/global/storage/types/storage.types';

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

  @Mutation('createOrderCustomUploadUrl')
  createOrderCustomUploadUrl(
    @CurrentUser() user: JwtUser,
    @Args('purpose') purpose: OrderCustomUploadPurpose,
    @Args('contentType') contentType: string,
    @Args('contentLength') contentLength: number,
  ): Promise<CreateUploadUrlOutput> {
    return this.checkoutService.createOrderCustomUploadUrl(
      parseAccountId(user),
      { purpose, contentType, contentLength },
    );
  }
}
