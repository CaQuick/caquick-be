import {
  buildOrderStatusNotification,
  buildRefundAccountRequestedNotification,
  buildReviewLikedNotification,
} from '@/features/notification/services/notification-payloads.helper';
import { ORDER_CANCEL_REASON_LABELS } from '@/features/order';
import {
  NotificationEvent,
  NotificationType,
  OrderCancelReason,
  type OrderActor,
  type OrderStatus,
} from '@/generated/prisma/client';

describe('notification-payloads.helper', () => {
  describe('buildOrderStatusNotification', () => {
    const status = (
      toStatus: OrderStatus,
      overrides: Partial<{
        actorType: OrderActor | null;
        cancelReason: OrderCancelReason | null;
      }> = {},
    ) =>
      buildOrderStatusNotification({
        orderNumber: 'ORD-1',
        toStatus,
        actorType: 'SELLER',
        cancelReason: null,
        ...overrides,
      });

    it.each([
      [
        'SUBMITTED',
        'ORDER_PAYMENT_CONFIRMED',
        '입금확인',
        '입금이 확인되어 주문이 접수되었어요.',
      ],
      ['CONFIRMED', 'ORDER_CONFIRMED', '주문확정', '주문이 확정되었어요.'],
      [
        'MADE',
        'ORDER_MADE',
        '제작완료',
        '주문하신 케이크 제작이 완료되었어요.',
      ],
      [
        'PICKED_UP',
        'ORDER_PICKED_UP',
        '픽업완료',
        '케이크 픽업이 완료되었어요.',
      ],
    ] as const)('%s는 %s(주문번호 접두)', (toStatus, event, title, body) => {
      expect(status(toStatus)).toEqual({
        type: NotificationType.ORDER_STATUS,
        event,
        title,
        body: `ORD-1 ${body}`,
      });
    });

    it.each(['PENDING_PAYMENT', 'NO_SHOW'] as const)(
      '매핑이 없는 상태(%s)는 null',
      (toStatus) => {
        expect(status(toStatus)).toBeNull();
      },
    );

    it.each(
      Object.values(OrderCancelReason).filter(
        (r) => r !== 'PAYMENT_NOT_RECEIVED',
      ),
    )('취소(%s)는 사유 라벨을 붙인 ORDER_CANCELED', (cancelReason) => {
      expect(status('CANCELED', { actorType: 'ADMIN', cancelReason })).toEqual({
        type: NotificationType.ORDER_STATUS,
        event: NotificationEvent.ORDER_CANCELED,
        title: '주문취소',
        body: `ORD-1 주문이 취소되었어요. 사유: ${ORDER_CANCEL_REASON_LABELS[cancelReason]}`,
      });
    });

    it.each(['ADMIN', 'SYSTEM'] as const)(
      '미입금 취소(%s)는 ORDER_PAYMENT_EXPIRED',
      (actorType) => {
        expect(
          status('CANCELED', {
            actorType,
            cancelReason: 'PAYMENT_NOT_RECEIVED',
          }),
        ).toEqual({
          type: NotificationType.ORDER_STATUS,
          event: NotificationEvent.ORDER_PAYMENT_EXPIRED,
          title: '주문취소',
          body: 'ORD-1 입금이 확인되지 않아 주문이 취소되었어요.',
        });
      },
    );

    it('사유가 없는 옛 취소 이벤트는 사유 없이 ORDER_CANCELED', () => {
      expect(status('CANCELED', { actorType: null })).toMatchObject({
        event: NotificationEvent.ORDER_CANCELED,
        body: 'ORD-1 주문이 취소되었어요.',
      });
    });

    it('구매자 본인 행위는 알림이 없다(입금 대기·접수 취소)', () => {
      expect(
        status('CANCELED', {
          actorType: 'BUYER',
          cancelReason: 'BUYER_REQUEST',
        }),
      ).toBeNull();
      expect(status('PENDING_PAYMENT', { actorType: 'BUYER' })).toBeNull();
    });
  });

  describe('buildRefundAccountRequestedNotification', () => {
    it('금액을 천 단위로 적어 계좌 입력을 요청한다', () => {
      expect(buildRefundAccountRequestedNotification('ORD-2', 30_000)).toEqual({
        type: NotificationType.ORDER_STATUS,
        event: NotificationEvent.REFUND_ACCOUNT_REQUESTED,
        title: '환불계좌입력',
        body: 'ORD-2 30,000원을 돌려받을 계좌를 입력해 주세요.',
      });
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
