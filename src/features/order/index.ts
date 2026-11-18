// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { OrderModule } from '@/features/order/order.module';
// 주문 집계(dashboard feature)와 주문 읽기(user·notification).
export {
  OrderRepository,
  type AdminOrderStatusCounts,
} from '@/features/order/repositories/order.repository';
// 주문 상태 전이 이벤트 계약(outbox). 소비자(notification)는 payload 스냅샷만 읽는다.
export {
  ORDER_STATUS_CHANGED,
  type OrderStatusChangedPayload,
  parseOrderStatusChangedPayload,
} from '@/features/order/events/order-status-changed.event';
// 취소 사유 라벨 — 구매자 취소 알림 본문(notification)이 주문 상세와 같은 값을 쓴다.
export { ORDER_CANCEL_REASON_LABELS } from '@/features/order/constants/order-cancel-reasons';
// 환불 생성 이벤트 계약(outbox). 구매자 환불 계좌 요청 알림(notification)이 읽는다.
export {
  REFUND_REQUESTED,
  type RefundRequestedPayload,
  parseRefundRequestedPayload,
} from '@/features/order/events/refund-requested.event';
// 주문 접수 이벤트 계약(outbox). 판매자 푸시 소비자(notification)가 읽는다.
export {
  ORDER_SUBMITTED,
  type OrderSubmittedPayload,
  parseOrderSubmittedPayload,
} from '@/features/order/events/order-submitted.event';
