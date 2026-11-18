import {
  buildBuyerMessagePush,
  buildOrderCanceledPush,
  buildOrderSubmittedPush,
  formatKstPickupAt,
} from '@/features/notification/services/seller-push-messages.helper';
import type { OrderStatusChangedPayload } from '@/features/order';
import { OrderActor, OrderStatus } from '@/generated/prisma/client';

describe('seller-push-messages.helper', () => {
  // UTC → KST(+9), 월·일은 0 채움 없이, 시·분은 두 자리
  it.each([
    ['2026-10-05T03:05:00.000Z', '10/5 12:05'],
    ['2026-10-05T15:30:00.000Z', '10/6 00:30'],
    ['2026-12-31T16:00:00.000Z', '1/1 01:00'],
    ['2026-03-09T00:00:00.000Z', '3/9 09:00'],
  ])('formatKstPickupAt(%s) → %s', (iso, expected) => {
    expect(formatKstPickupAt(new Date(iso))).toBe(expected);
  });

  const SUBMITTED = {
    orderId: '42',
    orderNumber: 'ORD-1',
    buyerAccountId: '7',
    storeId: '3',
    storeName: '케이크샵',
    productId: '9',
    productName: '레터링 케이크',
    quantity: 2,
    pickupAt: '2026-10-05T03:05:00.000Z',
    totalPrice: 50000,
    // 접수 10/4 12:00 KST + 24시간
    confirmDeadlineAt: '2026-10-05T03:00:00.000Z',
  };
  const SUBMITTED_AT = new Date('2026-10-04T03:00:00.000Z');

  it('주문 접수: 상품명·수량·픽업 시각(KST) 본문, 딥링크 data는 kind·orderId', () => {
    expect(buildOrderSubmittedPush(SUBMITTED, SUBMITTED_AT)).toEqual({
      title: '새 주문',
      body: '레터링 케이크 2개 · 픽업 10/5 12:05',
      data: { kind: 'ORDER_SUBMITTED', orderId: '42' },
    });
  });

  // 마감 2시간 전 미리 알림을 받을 수 없는 접수(마감 − 2시간 ≤ 접수)만 마감 시각을 싣는다
  it.each<[string, string | null, string]>([
    ['마감까지 2시간 1ms', '2026-10-04T05:00:00.001Z', ''],
    ['마감까지 정확히 2시간', '2026-10-04T05:00:00.000Z', ' · 14:00까지 확정'],
    ['마감까지 30분', '2026-10-04T03:30:00.000Z', ' · 12:30까지 확정'],
    ['마감 없음(옛 이벤트)', null, ''],
  ])('%s → 본문 꼬리 %p', (_case, deadline, suffix) => {
    expect(
      buildOrderSubmittedPush(
        { ...SUBMITTED, confirmDeadlineAt: deadline },
        SUBMITTED_AT,
      ).body,
    ).toBe(`레터링 케이크 2개 · 픽업 10/5 12:05${suffix}`);
  });

  it('구매자 문의: 본문은 preview 그대로, data는 kind·conversationId', () => {
    expect(
      buildBuyerMessagePush({
        conversationId: '11',
        storeId: '3',
        buyerAccountId: '7',
        messageId: '99',
        preview: '픽업 시간 바꿀 수 있나요?',
        messageCreatedAt: '2026-10-05T03:05:00.000Z',
      }),
    ).toEqual({
      title: '새 문의',
      body: '픽업 시간 바꿀 수 있나요?',
      data: { kind: 'BUYER_MESSAGE', conversationId: '11' },
    });
  });

  describe('buildOrderCanceledPush', () => {
    const CANCELED: OrderStatusChangedPayload = {
      orderId: '42',
      orderNumber: 'ORD-1',
      buyerAccountId: '7',
      fromStatus: 'SUBMITTED',
      toStatus: 'CANCELED',
      storeId: '3',
      storeName: '케이크샵',
      productId: '9',
      productName: '레터링 케이크',
      actorType: 'BUYER',
      cancelReason: 'BUYER_REQUEST',
      refundAmount: 30_000,
      pickupAt: '2026-10-05T03:05:00.000Z',
    };

    it.each([
      ['BUYER', '구매자'],
      ['ADMIN', '운영자'],
      ['SYSTEM', '자동'],
    ] as const)(
      '%s 취소: 본문 끝에 주체(%s), 딥링크는 주문',
      (actorType, label) => {
        expect(buildOrderCanceledPush({ ...CANCELED, actorType })).toEqual({
          storeId: '3',
          content: {
            title: '주문 취소',
            body: `레터링 케이크 · 픽업 10/5 12:05 주문이 취소됐어요(${label})`,
            data: { kind: 'ORDER_CANCELED', orderId: '42' },
          },
        });
      },
    );

    // 푸시 필터 전수: 취소 전이 ∧ 입금 전 주문 아님 ∧ 판매자 본인이 아닌 주체만
    const cases = Object.values(OrderStatus).flatMap((fromStatus) =>
      Object.values(OrderStatus).flatMap((toStatus) =>
        [...Object.values(OrderActor), null].map(
          (actorType) =>
            [
              fromStatus,
              toStatus,
              actorType,
              toStatus === 'CANCELED' &&
                fromStatus !== 'PENDING_PAYMENT' &&
                actorType !== null &&
                actorType !== 'SELLER',
            ] as const,
        ),
      ),
    );

    it('필터 표는 7 × 7 × 주체 5(모름 포함)를 덮고 보내는 경우는 18개다', () => {
      expect(cases).toHaveLength(245);
      expect(cases.filter(([, , , sent]) => sent)).toHaveLength(18);
    });

    it.each(cases)(
      '%s → %s by %s: 보냄 %s',
      (fromStatus, toStatus, actorType, sent) => {
        const push = buildOrderCanceledPush({
          ...CANCELED,
          fromStatus,
          toStatus,
          actorType,
        });
        expect(push !== null).toBe(sent);
      },
    );

    it('매장을 모르면(품목 없음) 보내지 않는다', () => {
      expect(buildOrderCanceledPush({ ...CANCELED, storeId: null })).toBeNull();
    });
  });
});
