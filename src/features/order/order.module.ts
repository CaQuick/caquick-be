import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { AdminOrderMutationResolver } from '@/features/order/resolvers/order-admin-mutation.resolver';
import { AdminOrderQueryResolver } from '@/features/order/resolvers/order-admin-query.resolver';
import { OrderCheckoutMutationResolver } from '@/features/order/resolvers/order-checkout-mutation.resolver';
import { UserOrderQueryResolver } from '@/features/order/resolvers/order-my-query.resolver';
import { SellerOrderMutationResolver } from '@/features/order/resolvers/order-seller-mutation.resolver';
import { SellerOrderQueryResolver } from '@/features/order/resolvers/order-seller-query.resolver';
import { AdminOrderService } from '@/features/order/services/order-admin.service';
import { OrderCheckoutService } from '@/features/order/services/order-checkout.service';
import { UserOrderService } from '@/features/order/services/order-my.service';
import { SellerOrderService } from '@/features/order/services/order-seller.service';
import { OutboxModule } from '@/features/outbox';
import { ProductModule } from '@/features/product';
import { StoreModule } from '@/features/store';

@Module({
  // 주문 생성이 상품 옵션 조회(ProductRepository)와 픽업 판정
  // (StorePickupScheduleService)을 소비한다 — 배럴 공개 API 경유.
  imports: [
    ProductModule,
    StoreModule,
    AuditLogModule,
    AuthModule,
    OutboxModule,
  ],
  providers: [
    OrderRepository,
    OrderStatusTransitionPolicy,
    OrderCheckoutService,
    OrderCheckoutMutationResolver,
    // 판매자 주문 관리(목록·상세·상태 변경) — 주문 도메인이 소유한다
    SellerOrderService,
    SellerOrderQueryResolver,
    SellerOrderMutationResolver,
    // 관리자 주문 관리(목록·상세·강제 취소)
    AdminOrderService,
    AdminOrderQueryResolver,
    AdminOrderMutationResolver,
    // 구매자 주문 목록·상세
    UserOrderService,
    UserOrderQueryResolver,
  ],
  exports: [OrderRepository, OrderStatusTransitionPolicy],
})
export class OrderModule {}
