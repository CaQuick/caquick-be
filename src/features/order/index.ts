// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { OrderModule } from '@/features/order/order.module';
export {
  OrderRepository,
  type AdminOrderDetailRow,
  type AdminOrderRow,
} from '@/features/order/repositories/order.repository';
export { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
// 주문 품목·상태 이력 출력 1벌. 구매자(user)·판매자(seller)·관리자(admin) 주문 상세가 같은 매퍼를 쓴다.
export {
  toOrderItemDetail,
  toOrderStatusHistory,
  type OrderItemDetailRow,
  type OrderStatusHistoryRow,
} from '@/features/order/services/order-output-mappers.helper';
export type {
  OrderItemDetailOutput,
  OrderStatusHistoryOutput,
} from '@/features/order/types/order-output.type';
