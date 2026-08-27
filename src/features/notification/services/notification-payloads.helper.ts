import {
  NotificationEvent,
  NotificationType,
  OrderStatus,
} from '@prisma/client';

import {
  ORDER_STATUS_NOTIFICATION_BODIES,
  ORDER_STATUS_NOTIFICATION_TITLES,
  REVIEW_LIKED_NOTIFICATION,
} from '@/features/notification/constants/notification-messages';

/**
 * 알림 내용(type·event·문구)의 단일 소스 (이슈 #203).
 * "무엇을 알릴지"는 여기서, "언제 어떤 row로 저장할지"는 각 repository가
 * 트랜잭션 안에서 담당한다 — 문구·채널 정책이 바뀌어도 데이터 계층은 불변.
 * DI-free 순수 함수만 둔다.
 */

export interface NotificationPayload {
  type: NotificationType;
  event: NotificationEvent;
  title: string;
  body: string;
}

/** 주문 상태 → 알림 이벤트. 알림 대상이 아닌 상태(CANCELED 등)는 null. */
const ORDER_STATUS_NOTIFICATION_EVENTS: Partial<
  Record<OrderStatus, NotificationEvent>
> = {
  [OrderStatus.CONFIRMED]: NotificationEvent.ORDER_CONFIRMED,
  [OrderStatus.MADE]: NotificationEvent.ORDER_MADE,
  [OrderStatus.PICKED_UP]: NotificationEvent.ORDER_PICKED_UP,
};

/**
 * 주문 상태 변경 알림 payload. 알림 대상이 아닌 상태면 null을 반환하고,
 * 호출부는 그 경우 알림을 생성하지 않는다(CANCELED는 정책상 알림 없음).
 */
export function buildOrderStatusNotification(
  orderNumber: string,
  toStatus: OrderStatus,
): NotificationPayload | null {
  const event = ORDER_STATUS_NOTIFICATION_EVENTS[toStatus];
  const title = ORDER_STATUS_NOTIFICATION_TITLES[toStatus];
  const body = ORDER_STATUS_NOTIFICATION_BODIES[toStatus];
  if (!event || !title || !body) return null;
  return {
    type: NotificationType.ORDER_STATUS,
    event,
    title,
    body: `${orderNumber} ${body}`,
  };
}

/** 리뷰 최초 좋아요 알림 payload(복원 좋아요는 호출부에서 알림 생략). */
export function buildReviewLikedNotification(): NotificationPayload {
  return {
    type: NotificationType.REVIEW_LIKE,
    event: NotificationEvent.REVIEW_LIKED,
    title: REVIEW_LIKED_NOTIFICATION.title,
    body: REVIEW_LIKED_NOTIFICATION.body,
  };
}
