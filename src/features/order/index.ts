// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { OrderModule } from '@/features/order/order.module';
// 주문 집계(dashboard feature)와 주문 읽기(user·notification).
export { OrderRepository } from '@/features/order/repositories/order.repository';
// 주문 상태 전이 이벤트 계약(outbox). 소비자(notification)는 payload 스냅샷만 읽는다.
export {
  ORDER_STATUS_CHANGED,
  parseOrderStatusChangedPayload,
} from '@/features/order/events/order-status-changed.event';
