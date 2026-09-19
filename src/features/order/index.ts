// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { OrderModule } from '@/features/order/order.module';
// 주문 집계(dashboard feature)와 주문 읽기(user·notification).
export { OrderRepository } from '@/features/order/repositories/order.repository';
// 주문 품목·상태 이력 출력 1벌. 구매자(user)·관리자(admin) 주문 상세가 같은 매퍼를 쓴다(판매자는 order 안).
export {
  toOrderItemDetail,
  toOrderStatusHistory,
} from '@/features/order/services/order-output-mappers.helper';
export type {
  OrderItemDetailOutput,
  OrderStatusHistoryOutput,
} from '@/features/order/types/order-output.type';
