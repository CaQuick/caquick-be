import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { SellerRescheduleOrderPickupInput } from '@/features/order/dto/inputs/seller-reschedule-order-pickup.input';
import { SellerOrderPickupService } from '@/features/order/services/order-seller-pickup.service';
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
export class SellerOrderPickupMutationResolver {
  constructor(private readonly pickupService: SellerOrderPickupService) {}

  @Mutation('sellerRescheduleOrderPickup')
  sellerRescheduleOrderPickup(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerRescheduleOrderPickupInput,
  ): Promise<SellerOrderSummaryOutput> {
    return this.pickupService.sellerRescheduleOrderPickup(
      parseAccountId(user),
      input,
    );
  }
}
