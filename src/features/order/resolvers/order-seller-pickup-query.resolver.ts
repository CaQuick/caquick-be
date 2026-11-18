import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { SellerOrderPickupService } from '@/features/order/services/order-seller-pickup.service';
import type { PickupCalendar, PickupTimeSlots } from '@/features/store';
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
export class SellerOrderPickupQueryResolver {
  constructor(private readonly pickupService: SellerOrderPickupService) {}

  @Query('sellerOrderPickupCalendar')
  sellerOrderPickupCalendar(
    @CurrentUser() user: JwtUser,
    @Args('orderId') orderId: string,
    @Args('yearMonth') yearMonth: string,
  ): Promise<PickupCalendar> {
    return this.pickupService.sellerOrderPickupCalendar(
      parseAccountId(user),
      parseId(orderId),
      yearMonth,
    );
  }

  @Query('sellerOrderPickupTimeSlots')
  sellerOrderPickupTimeSlots(
    @CurrentUser() user: JwtUser,
    @Args('orderId') orderId: string,
    @Args('date') date: string,
  ): Promise<PickupTimeSlots> {
    return this.pickupService.sellerOrderPickupTimeSlots(
      parseAccountId(user),
      parseId(orderId),
      date,
    );
  }
}
