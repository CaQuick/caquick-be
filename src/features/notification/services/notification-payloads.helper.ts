import {
  ORDER_STATUS_NOTIFICATION_BODIES,
  ORDER_STATUS_NOTIFICATION_TITLES,
  REVIEW_LIKED_NOTIFICATION,
} from '@/features/notification/constants/notification-messages';
import {
  NotificationEvent,
  NotificationType,
  OrderStatus,
} from '@/generated/prisma/client';

/**
 * "무엇을 알릴지"는 여기서, "언제 어떤 row로 저장할지"는 각 repository가 트랜잭션 안에서 담당한다 —
 * 문구·채널 정책이 바뀌어도 데이터 계층은 불변. DI-free 순수 함수만 둔다.
 */

export interface NotificationPayload {
  type: NotificationType;
  event: NotificationEvent;
  title: string;
  body: string;
}

const ORDER_STATUS_NOTIFICATION_EVENTS: Partial<
  Record<OrderStatus, NotificationEvent>
> = {
  // 접수는 관리자 입금 확인으로만 일어난다(주문 생성은 입금 대기)
  [OrderStatus.SUBMITTED]: NotificationEvent.ORDER_PAYMENT_CONFIRMED,
  [OrderStatus.CONFIRMED]: NotificationEvent.ORDER_CONFIRMED,
  [OrderStatus.MADE]: NotificationEvent.ORDER_MADE,
  [OrderStatus.PICKED_UP]: NotificationEvent.ORDER_PICKED_UP,
  [OrderStatus.CANCELED]: NotificationEvent.ORDER_CANCELED,
};

/** 매핑에 없는 상태는 알림 없음(null). */
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

/** 복원 좋아요는 호출부에서 알림 생략. */
export function buildReviewLikedNotification(): NotificationPayload {
  return {
    type: NotificationType.REVIEW_LIKE,
    event: NotificationEvent.REVIEW_LIKED,
    title: REVIEW_LIKED_NOTIFICATION.title,
    body: REVIEW_LIKED_NOTIFICATION.body,
  };
}
