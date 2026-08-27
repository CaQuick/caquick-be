import { OrderStatus } from '@prisma/client';

/** 주문 상태별 알림 제목. 매핑이 없는 상태는 알림을 만들지 않는다. */
export const ORDER_STATUS_NOTIFICATION_TITLES: Partial<
  Record<OrderStatus, string>
> = {
  [OrderStatus.CONFIRMED]: '주문이 확정되었습니다',
  [OrderStatus.MADE]: '주문이 제작 완료되었습니다',
  [OrderStatus.PICKED_UP]: '주문이 픽업 처리되었습니다',
};

/** 주문 상태별 알림 본문. 주문번호를 앞에 붙여 조립한다. */
export const ORDER_STATUS_NOTIFICATION_BODIES: Partial<
  Record<OrderStatus, string>
> = {
  [OrderStatus.CONFIRMED]: '주문이 확정되었습니다.',
  [OrderStatus.MADE]: '주문의 상품 제작이 완료되었습니다.',
  [OrderStatus.PICKED_UP]: '주문이 픽업 완료 처리되었습니다.',
};

export const REVIEW_LIKED_NOTIFICATION = {
  title: '리뷰에 좋아요가 추가되었습니다',
  body: '회원님의 리뷰를 다른 사용자가 좋아합니다.',
} as const;
