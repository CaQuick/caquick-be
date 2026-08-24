import { Module } from '@nestjs/common';

import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { OrderCheckoutMutationResolver } from '@/features/order/resolvers/order-checkout-mutation.resolver';
import { OrderCheckoutService } from '@/features/order/services/order-checkout.service';
import { OrderDomainService } from '@/features/order/services/order-domain.service';
import { ProductModule } from '@/features/product';
import { StoreModule } from '@/features/store';

@Module({
  // 주문 생성이 상품 옵션 조회(ProductRepository)와 픽업 판정
  // (StorePickupScheduleService)을 소비한다 — 배럴 공개 API 경유.
  imports: [ProductModule, StoreModule],
  providers: [
    OrderRepository,
    OrderStatusTransitionPolicy,
    OrderDomainService,
    OrderCheckoutService,
    OrderCheckoutMutationResolver,
  ],
  exports: [OrderRepository, OrderStatusTransitionPolicy, OrderDomainService],
})
export class OrderModule {}
