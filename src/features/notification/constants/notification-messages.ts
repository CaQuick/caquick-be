import { OrderStatus } from '@prisma/client';

/**
 * 주문 상태별 알림 제목(알림센터 라벨). 매핑이 없는 상태는 알림을 만들지 않는다.
 * 문구는 figma notification-center 알림 목록 화면 기준.
 */
export const ORDER_STATUS_NOTIFICATION_TITLES: Partial<
  Record<OrderStatus, string>
> = {
  [OrderStatus.CONFIRMED]: '주문확정',
  [OrderStatus.MADE]: '제작완료',
  [OrderStatus.PICKED_UP]: '픽업완료',
};

/**
 * 주문 상태별 알림 본문. 주문번호를 앞에 붙여 조립한다.
 * (figma 알림센터에는 주문번호가 노출되지 않지만, 식별 필요 가능성에 대비해
 * prefix는 유지한다 — 표시 여부는 FE 판단. 사용자 확정 정책)
 */
export const ORDER_STATUS_NOTIFICATION_BODIES: Partial<
  Record<OrderStatus, string>
> = {
  [OrderStatus.CONFIRMED]: '주문이 확정되었어요.',
  [OrderStatus.MADE]: '주문하신 케이크 제작이 완료되었어요.',
  [OrderStatus.PICKED_UP]: '케이크 픽업이 완료되었어요.',
};

// 문구는 figma notification-center 알림 목록 화면 기준.
export const REVIEW_LIKED_NOTIFICATION = {
  title: '리뷰 좋아요',
  body: '다른 사람이 내가 남긴 리뷰를 좋아했어요.',
} as const;
