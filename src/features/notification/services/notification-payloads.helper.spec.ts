import {
  NotificationEvent,
  NotificationType,
  OrderStatus,
} from '@prisma/client';

import {
  buildOrderStatusNotification,
  buildReviewLikedNotification,
} from '@/features/notification/services/notification-payloads.helper';

describe('notification-payloads.helper', () => {
  describe('buildOrderStatusNotification', () => {
    it('CONFIRMED는 주문번호가 붙은 확정 알림 payload를 만든다', () => {
      expect(
        buildOrderStatusNotification('ORD-1', OrderStatus.CONFIRMED),
      ).toEqual({
        type: NotificationType.ORDER_STATUS,
        event: NotificationEvent.ORDER_CONFIRMED,
        title: '주문확정',
        body: 'ORD-1 주문이 확정되었어요.',
      });
    });

    it('MADE·PICKED_UP도 상태별 이벤트·문구로 매핑된다', () => {
      expect(buildOrderStatusNotification('ORD-2', OrderStatus.MADE)).toEqual({
        type: NotificationType.ORDER_STATUS,
        event: NotificationEvent.ORDER_MADE,
        title: '제작완료',
        body: 'ORD-2 주문하신 케이크 제작이 완료되었어요.',
      });
      expect(
        buildOrderStatusNotification('ORD-3', OrderStatus.PICKED_UP),
      ).toEqual({
        type: NotificationType.ORDER_STATUS,
        event: NotificationEvent.ORDER_PICKED_UP,
        title: '픽업완료',
        body: 'ORD-3 케이크 픽업이 완료되었어요.',
      });
    });

    it('알림 대상이 아닌 상태(CANCELED·SUBMITTED)는 null을 반환한다', () => {
      expect(
        buildOrderStatusNotification('ORD-4', OrderStatus.CANCELED),
      ).toBeNull();
      expect(
        buildOrderStatusNotification('ORD-5', OrderStatus.SUBMITTED),
      ).toBeNull();
    });
  });

  describe('buildReviewLikedNotification', () => {
    it('리뷰 좋아요 알림 payload를 만든다', () => {
      expect(buildReviewLikedNotification()).toEqual({
        type: NotificationType.REVIEW_LIKE,
        event: NotificationEvent.REVIEW_LIKED,
        title: '리뷰 좋아요',
        body: '다른 사람이 내가 남긴 리뷰를 좋아했어요.',
      });
    });
  });
});
