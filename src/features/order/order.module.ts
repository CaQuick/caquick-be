import { Module } from '@nestjs/common';

import { OrderStatusPolicy } from './policies/order-status.policy';
import { OrderRepository } from './repositories/order.repository';

@Module({
  providers: [OrderRepository, OrderStatusPolicy],
  exports: [OrderRepository, OrderStatusPolicy],
})
export class OrderModule {}
