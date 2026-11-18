import {
  parsePaymentDepositClaimedPayload,
  PAYMENT_DEPOSIT_CLAIMED,
  paymentDepositClaimedEvent,
} from '@/features/order/events/payment-deposit-claimed.event';
import type { Prisma } from '@/generated/prisma/client';

const VALID = {
  orderId: '7',
  orderNumber: 'ORD-20260916-ABC234',
  amount: 56000,
  depositorName: '차차맘',
};

describe('payment.deposit_claimed 이벤트', () => {
  it('주문과 같은 aggregate(파티션)에 묶고 행위자는 구매자다', () => {
    const occurredAt = new Date('2026-09-16T07:30:00.000Z');
    const event = paymentDepositClaimedEvent({
      orderId: 7n,
      orderNumber: VALID.orderNumber,
      buyerAccountId: 3n,
      amount: 56000,
      depositorName: '차차맘',
      occurredAt,
    });

    expect(event).toEqual({
      aggregateType: 'order',
      aggregateId: '7',
      eventType: PAYMENT_DEPOSIT_CLAIMED,
      payload: VALID,
      occurredAt,
      actorAccountId: 3n,
    });
    expect(
      parsePaymentDepositClaimedPayload(event.payload as Prisma.JsonValue),
    ).toEqual(VALID);
  });

  it.each([
    ['null', null],
    ['배열', [VALID]],
    ['문자열', 'x'],
    ['orderId 숫자', { ...VALID, orderId: 7 }],
    ['orderNumber 누락', { ...VALID, orderNumber: undefined }],
    ['amount 문자열', { ...VALID, amount: '56000' }],
    ['depositorName 누락', { ...VALID, depositorName: undefined }],
  ])('반증: %s payload는 던진다', (_label, payload) => {
    expect(() =>
      parsePaymentDepositClaimedPayload(payload as Prisma.JsonValue),
    ).toThrow('payload 형식 오류');
  });
});
