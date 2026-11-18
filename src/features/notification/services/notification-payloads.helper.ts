import {
  ORDER_CANCELED_NOTIFICATION,
  ORDER_PAYMENT_EXPIRED_NOTIFICATION,
  ORDER_STATUS_NOTIFICATION_BODIES,
  ORDER_STATUS_NOTIFICATION_TITLES,
  REFUND_ACCOUNT_REQUESTED_TITLE,
  REVIEW_LIKED_NOTIFICATION,
} from '@/features/notification/constants/notification-messages';
import {
  ORDER_CANCEL_REASON_LABELS,
  type OrderStatusChangedPayload,
} from '@/features/order';
import {
  NotificationEvent,
  NotificationType,
  OrderActor,
  OrderCancelReason,
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
};

/** 매핑에 없는 상태와 구매자 본인 행위(취소)는 알림 없음(null). */
export function buildOrderStatusNotification(
  p: Pick<
    OrderStatusChangedPayload,
    'orderNumber' | 'toStatus' | 'actorType' | 'cancelReason'
  >,
): NotificationPayload | null {
  if (p.actorType === OrderActor.BUYER) return null;
  if (p.toStatus === OrderStatus.CANCELED) return buildOrderCanceled(p);
  const event = ORDER_STATUS_NOTIFICATION_EVENTS[p.toStatus];
  const title = ORDER_STATUS_NOTIFICATION_TITLES[p.toStatus];
  const body = ORDER_STATUS_NOTIFICATION_BODIES[p.toStatus];
  if (!event || !title || !body) return null;
  return {
    type: NotificationType.ORDER_STATUS,
    event,
    title,
    body: `${p.orderNumber} ${body}`,
  };
}

function buildOrderCanceled(
  p: Pick<OrderStatusChangedPayload, 'orderNumber' | 'cancelReason'>,
): NotificationPayload {
  if (p.cancelReason === OrderCancelReason.PAYMENT_NOT_RECEIVED) {
    return {
      type: NotificationType.ORDER_STATUS,
      event: NotificationEvent.ORDER_PAYMENT_EXPIRED,
      title: ORDER_PAYMENT_EXPIRED_NOTIFICATION.title,
      body: `${p.orderNumber} ${ORDER_PAYMENT_EXPIRED_NOTIFICATION.body}`,
    };
  }
  // 사유가 없는 건 취소 정책 도입 전 이벤트다
  const reason = p.cancelReason
    ? ` 사유: ${ORDER_CANCEL_REASON_LABELS[p.cancelReason]}`
    : '';
  return {
    type: NotificationType.ORDER_STATUS,
    event: NotificationEvent.ORDER_CANCELED,
    title: ORDER_CANCELED_NOTIFICATION.title,
    body: `${p.orderNumber} ${ORDER_CANCELED_NOTIFICATION.body}${reason}`,
  };
}

/** 돌려줄 돈이 생겼을 때 계좌 입력을 요청한다. */
export function buildRefundAccountRequestedNotification(
  orderNumber: string,
  amount: number,
): NotificationPayload {
  return {
    type: NotificationType.ORDER_STATUS,
    event: NotificationEvent.REFUND_ACCOUNT_REQUESTED,
    title: REFUND_ACCOUNT_REQUESTED_TITLE,
    body: `${orderNumber} ${amount.toLocaleString('ko-KR')}원을 돌려받을 계좌를 입력해 주세요.`,
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
