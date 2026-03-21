import { Module } from '@nestjs/common';

import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { OrderDomainService } from '@/features/order/services/order-domain.service';

@Module({
  providers: [OrderRepository, OrderStatusTransitionPolicy, OrderDomainService],
  exports: [OrderRepository, OrderStatusTransitionPolicy, OrderDomainService],
})
export class OrderModule {}
