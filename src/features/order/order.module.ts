import { Module } from '@nestjs/common';

import { BOOKED_QUANTITY_QUERY } from '@/common/ports/booked-quantity.port';
import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderBookedRepository } from '@/features/order/repositories/order-booked.repository';
import { OrderStoreDailyLimitRepository } from '@/features/order/repositories/order-store-daily-limit.repository';
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
import { OrderStoreDailyLimitConsumer } from '@/features/order/services/order-store-daily-limit.consumer';
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
    // catalog 픽업 판정이 읽는 예약 수량(booked) 포트 구현
    { provide: BOOKED_QUANTITY_QUERY, useClass: OrderBookedRepository },
    // 일일 capacity 복제본 + 변경 이벤트 소비자
    OrderStoreDailyLimitRepository,
    OrderStoreDailyLimitConsumer,
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
  exports: [
    OrderRepository,
    OrderStatusTransitionPolicy,
    BOOKED_QUANTITY_QUERY,
  ],
})
export class OrderModule {}
