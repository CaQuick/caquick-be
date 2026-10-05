import { UseGuards } from '@nestjs/common';
import { Resolver, Subscription } from '@nestjs/graphql';

import { OrderSubscriptionService } from '@/features/order/services/order-subscription.service';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/** 이벤트 payload는 발행 시 이미 GraphQL 출력 형태라 resolve는 그대로 통과시킨다. */
const passthrough = { resolve: (payload: unknown): unknown => payload };

@Resolver('Subscription')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class OrderSubscriptionResolver {
  constructor(private readonly subscriptionService: OrderSubscriptionService) {}

  @Subscription('sellerOrderUpdated', passthrough)
  sellerOrderUpdated(
    @CurrentUser() user: JwtUser,
  ): Promise<AsyncIterator<unknown>> {
    const accountId = parseAccountId(user);
    return this.subscriptionService.subscribeSellerOrderUpdates(accountId);
  }
}
