import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { OrderCheckoutMutationResolver } from '@/features/order/resolvers/order-checkout-mutation.resolver';
import { SellerOrderMutationResolver } from '@/features/order/resolvers/order-seller-mutation.resolver';
import { SellerOrderQueryResolver } from '@/features/order/resolvers/order-seller-query.resolver';
import { OrderCheckoutService } from '@/features/order/services/order-checkout.service';
import { SellerOrderService } from '@/features/order/services/order-seller.service';
import { ProductModule } from '@/features/product';
import { StoreModule } from '@/features/store';

@Module({
  // 주문 생성이 상품 옵션 조회(ProductRepository)와 픽업 판정
  // (StorePickupScheduleService)을 소비한다 — 배럴 공개 API 경유.
  imports: [ProductModule, StoreModule, AuditLogModule],
  providers: [
    OrderRepository,
    OrderStatusTransitionPolicy,
    OrderCheckoutService,
    OrderCheckoutMutationResolver,
    // 판매자 주문 관리(목록·상세·상태 변경) — 주문 도메인이 소유한다
    SellerOrderService,
    SellerOrderQueryResolver,
    SellerOrderMutationResolver,
  ],
  exports: [OrderRepository, OrderStatusTransitionPolicy],
})
export class OrderModule {}
