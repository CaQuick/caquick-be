import { OrderStatus } from '@/generated/prisma/client';

/** 매핑이 없는 상태는 알림을 만들지 않는다. */
export const ORDER_STATUS_NOTIFICATION_TITLES: Partial<
  Record<OrderStatus, string>
> = {
  [OrderStatus.CONFIRMED]: '주문확정',
  [OrderStatus.MADE]: '제작완료',
  [OrderStatus.PICKED_UP]: '픽업완료',
  // 관리자 강제 취소 도입 시 판매자 취소와 함께 알리기로 확정
  [OrderStatus.CANCELED]: '주문취소',
};

/** 주문번호 prefix는 식별 필요 가능성에 대비해 유지한다 — 표시 여부는 FE 판단. */
export const ORDER_STATUS_NOTIFICATION_BODIES: Partial<
  Record<OrderStatus, string>
> = {
  [OrderStatus.CONFIRMED]: '주문이 확정되었어요.',
  [OrderStatus.MADE]: '주문하신 케이크 제작이 완료되었어요.',
  [OrderStatus.PICKED_UP]: '케이크 픽업이 완료되었어요.',
  [OrderStatus.CANCELED]: '주문이 취소되었어요.',
};

export const REVIEW_LIKED_NOTIFICATION = {
  title: '리뷰 좋아요',
  body: '다른 사람이 내가 남긴 리뷰를 좋아했어요.',
} as const;
