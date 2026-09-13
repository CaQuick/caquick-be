// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { OrderModule } from '@/features/order/order.module';
export {
  OrderRepository,
  // 관리자 주문 조회 행(admin feature). 매핑 규칙은 admin이 갖고 저장·잠금·알림·감사는 여기가 단일 소스
  type AdminOrderDetailRow,
  type AdminOrderRow,
} from '@/features/order/repositories/order.repository';
export { OrderDomainService } from '@/features/order/services/order-domain.service';
export { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
