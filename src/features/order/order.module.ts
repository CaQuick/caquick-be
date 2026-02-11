import { Module } from '@nestjs/common';

import { OrderStatusTransitionPolicy } from './policies/order-status-transition.policy';
import { OrderRepository } from './repositories/order.repository';
import { OrderDomainService } from './services/order-domain.service';

@Module({
  providers: [OrderRepository, OrderStatusTransitionPolicy, OrderDomainService],
  exports: [OrderRepository, OrderStatusTransitionPolicy, OrderDomainService],
})
export class OrderModule {}
