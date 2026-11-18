import { OrderStatus } from '@/generated/prisma/client';

/** 매핑이 없는 상태는 알림을 만들지 않는다. 취소는 아래 문구로 따로 만든다. */
export const ORDER_STATUS_NOTIFICATION_TITLES: Partial<
  Record<OrderStatus, string>
> = {
  [OrderStatus.SUBMITTED]: '입금확인',
  [OrderStatus.CONFIRMED]: '주문확정',
  [OrderStatus.MADE]: '제작완료',
  [OrderStatus.PICKED_UP]: '픽업완료',
  [OrderStatus.NO_SHOW]: '노쇼',
};

/** 주문번호 prefix는 식별 필요 가능성에 대비해 유지한다 — 표시 여부는 FE 판단. */
export const ORDER_STATUS_NOTIFICATION_BODIES: Partial<
  Record<OrderStatus, string>
> = {
  [OrderStatus.SUBMITTED]: '입금이 확인되어 주문이 접수되었어요.',
  [OrderStatus.CONFIRMED]: '주문이 확정되었어요.',
  [OrderStatus.MADE]: '주문하신 케이크 제작이 완료되었어요.',
  [OrderStatus.PICKED_UP]: '케이크 픽업이 완료되었어요.',
  [OrderStatus.NO_SHOW]: '픽업 시간에 방문하지 않아 노쇼로 처리되었어요.',
};

/** 취소는 사유 라벨을 덧붙인다(판매자·운영자·자동 미확정 공통). */
export const ORDER_CANCELED_NOTIFICATION = {
  title: '주문취소',
  body: '주문이 취소되었어요.',
} as const;

/** 미입금(PAYMENT_NOT_RECEIVED) 취소는 일반 취소 문구 대신 이 문구로 알린다. */
export const ORDER_PAYMENT_EXPIRED_NOTIFICATION = {
  title: '주문취소',
  body: '입금이 확인되지 않아 주문이 취소되었어요.',
} as const;

export const REFUND_ACCOUNT_REQUESTED_TITLE = '환불계좌입력';

export const REFUND_COMPLETED_TITLE = '환불완료';

export const REVIEW_LIKED_NOTIFICATION = {
  title: '리뷰 좋아요',
  body: '다른 사람이 내가 남긴 리뷰를 좋아했어요.',
} as const;
