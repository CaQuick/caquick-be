import { Injectable } from '@nestjs/common';

import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderStatus } from '@/generated/prisma/client';

@Injectable()
export class OrderDomainService {
  constructor(
    private readonly orderStatusTransitionPolicy: OrderStatusTransitionPolicy,
  ) {}

  parseStatus(raw: string): OrderStatus {
    return this.orderStatusTransitionPolicy.parse(raw);
  }

  assertSellerTransition(from: OrderStatus, to: OrderStatus): void {
    this.orderStatusTransitionPolicy.assertSellerTransition(from, to);
  }

  requiresCancellationNote(status: OrderStatus): boolean {
    return this.orderStatusTransitionPolicy.requiresCancellationNote(status);
  }
}
