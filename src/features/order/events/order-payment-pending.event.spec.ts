import {
  ORDER_PAYMENT_PENDING,
  orderPaymentPendingEvent,
  parseOrderPaymentPendingPayload,
} from '@/features/order/events/order-payment-pending.event';
import type { Prisma } from '@/generated/prisma/client';

const VALID = {
  orderId: '7',
  orderNumber: 'ORD-20260916-ABC234',
  amount: 56000,
  depositorName: '차차맘',
  expiresAt: '2026-09-16T08:00:00.000Z',
};

describe('order.payment_pending 이벤트', () => {
  it('bigint·Date를 문자열로 싣고 order aggregate에 묶는다(행위자는 구매자)', () => {
    const occurredAt = new Date('2026-09-16T07:00:00.000Z');
    const event = orderPaymentPendingEvent({
      orderId: 7n,
      orderNumber: VALID.orderNumber,
      buyerAccountId: 3n,
      amount: 56000,
      depositorName: '차차맘',
      expiresAt: new Date(VALID.expiresAt),
      occurredAt,
    });

    expect(event).toEqual({
      aggregateType: 'order',
      aggregateId: '7',
      eventType: ORDER_PAYMENT_PENDING,
      payload: VALID,
      occurredAt,
      actorAccountId: 3n,
    });
    expect(
      parseOrderPaymentPendingPayload(event.payload as Prisma.JsonValue),
    ).toEqual(VALID);
  });

  it.each([
    ['null', null],
    ['배열', [VALID]],
    ['orderId 숫자', { ...VALID, orderId: 7 }],
    ['orderNumber 누락', { ...VALID, orderNumber: undefined }],
    ['amount 문자열', { ...VALID, amount: '56000' }],
    ['amount 소수', { ...VALID, amount: 1.5 }],
    ['depositorName null', { ...VALID, depositorName: null }],
    ['expiresAt 숫자', { ...VALID, expiresAt: 1_700_000_000 }],
    ['expiresAt 비ISO', { ...VALID, expiresAt: 'not-a-date' }],
  ])('반증: %s payload는 던진다', (_label, payload) => {
    expect(() =>
      parseOrderPaymentPendingPayload(payload as Prisma.JsonValue),
    ).toThrow('payload 형식 오류');
  });
});
