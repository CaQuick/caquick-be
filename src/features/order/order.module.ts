import { Module } from '@nestjs/common';

import { BOOKED_QUANTITY_QUERY } from '@/common/ports/booked-quantity.port';
import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderBookedRepository } from '@/features/order/repositories/order-booked.repository';
import { OrderStoreDailyLimitRepository } from '@/features/order/repositories/order-store-daily-limit.repository';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { PaymentSettingRepository } from '@/features/order/repositories/payment-setting.repository';
import { PaymentRepository } from '@/features/order/repositories/payment.repository';
import { StoreSettlementAccountRepository } from '@/features/order/repositories/store-settlement-account.repository';
import { AdminOrderMutationResolver } from '@/features/order/resolvers/order-admin-mutation.resolver';
import { AdminOrderQueryResolver } from '@/features/order/resolvers/order-admin-query.resolver';
import { OrderCheckoutMutationResolver } from '@/features/order/resolvers/order-checkout-mutation.resolver';
import { AdminDepositMutationResolver } from '@/features/order/resolvers/order-deposit-admin-mutation.resolver';
import { AdminDepositQueryResolver } from '@/features/order/resolvers/order-deposit-admin-query.resolver';
import { UserOrderMutationResolver } from '@/features/order/resolvers/order-my-mutation.resolver';
import { UserOrderQueryResolver } from '@/features/order/resolvers/order-my-query.resolver';
import { AdminPaymentMutationResolver } from '@/features/order/resolvers/order-payment-admin-mutation.resolver';
import { AdminPaymentQueryResolver } from '@/features/order/resolvers/order-payment-admin-query.resolver';
import { PaymentQueryResolver } from '@/features/order/resolvers/order-payment-query.resolver';
import { SellerOrderMutationResolver } from '@/features/order/resolvers/order-seller-mutation.resolver';
import { SellerOrderQueryResolver } from '@/features/order/resolvers/order-seller-query.resolver';
import { SellerSettlementMutationResolver } from '@/features/order/resolvers/order-settlement-seller-mutation.resolver';
import { SellerSettlementQueryResolver } from '@/features/order/resolvers/order-settlement-seller-query.resolver';
import { OrderSubscriptionResolver } from '@/features/order/resolvers/order-subscription.resolver';
import { OrderAdminAlertConsumer } from '@/features/order/services/order-admin-alert.consumer';
import { AdminOrderService } from '@/features/order/services/order-admin.service';
import { OrderCheckoutService } from '@/features/order/services/order-checkout.service';
import { AdminDepositService } from '@/features/order/services/order-deposit-admin.service';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { UserOrderService } from '@/features/order/services/order-my.service';
import { AdminPaymentService } from '@/features/order/services/order-payment-admin.service';
import { SellerOrderService } from '@/features/order/services/order-seller.service';
import { SellerSettlementService } from '@/features/order/services/order-settlement-seller.service';
import { OrderStoreDailyLimitConsumer } from '@/features/order/services/order-store-daily-limit.consumer';
import { OrderSubscriptionService } from '@/features/order/services/order-subscription.service';
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
    // 판매자 주문 구독(Redis PubSub) — 발행은 입금 확인·판매자 상태 변경·관리자 취소 서비스가 커밋 뒤 직접
    OrderEventsService,
    OrderSubscriptionService,
    OrderSubscriptionResolver,
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
    // 구매자 주문 목록·상세·'입금했어요'
    UserOrderService,
    UserOrderQueryResolver,
    UserOrderMutationResolver,
    // 결제(입금 대기)와 상태 전이 잠금 단위, 관리자 입금 확인
    PaymentRepository,
    OrderTransitionRepository,
    AdminDepositService,
    AdminDepositQueryResolver,
    AdminDepositMutationResolver,
    // 입금 대기·'입금했어요' 관리자 디스코드 알림(worker 소비자)
    OrderAdminAlertConsumer,
    // 결제 설정·매장 정산 계좌(계좌번호는 global AccountCipher로 암호화)
    PaymentSettingRepository,
    StoreSettlementAccountRepository,
    PaymentQueryResolver,
    AdminPaymentService,
    AdminPaymentQueryResolver,
    AdminPaymentMutationResolver,
    SellerSettlementService,
    SellerSettlementQueryResolver,
    SellerSettlementMutationResolver,
  ],
  exports: [
    OrderRepository,
    OrderStatusTransitionPolicy,
    BOOKED_QUANTITY_QUERY,
  ],
})
export class OrderModule {}
