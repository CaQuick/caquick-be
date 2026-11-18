import {
  parseRefundRequestedPayload,
  REFUND_REQUESTED,
  refundRequestedEvent,
} from '@/features/order/events/refund-requested.event';
import type { Prisma } from '@/generated/prisma/client';

const VALID = {
  refundId: '11',
  orderId: '7',
  orderNumber: 'ORD-1',
  buyerAccountId: '3',
  kind: 'CANCEL',
  amount: 30_000,
  storeId: '2',
  storeName: '케이크샵',
  productId: '5',
  productName: '레터링 케이크',
};

describe('refund.requested 이벤트', () => {
  it('주문과 같은 aggregate(파티션)에 묶고 파서가 그대로 읽는다', () => {
    const occurredAt = new Date('2026-09-16T07:30:00.000Z');
    const event = refundRequestedEvent({
      refundId: 11n,
      orderId: 7n,
      orderNumber: 'ORD-1',
      buyerAccountId: 3n,
      kind: 'CANCEL',
      amount: 30_000,
      storeId: 2n,
      storeName: '케이크샵',
      productId: 5n,
      productName: '레터링 케이크',
      occurredAt,
      actorAccountId: 9n,
    });

    expect(event).toEqual({
      aggregateType: 'order',
      aggregateId: '7',
      eventType: REFUND_REQUESTED,
      payload: VALID,
      occurredAt,
      actorAccountId: 9n,
    });
    expect(
      parseRefundRequestedPayload(event.payload as Prisma.JsonValue),
    ).toEqual(VALID);
  });

  it('매장·상품 스냅샷이 없으면 null로 읽는다', () => {
    expect(
      parseRefundRequestedPayload({
        ...VALID,
        storeId: null,
        storeName: undefined,
        productId: null,
        productName: null,
      }),
    ).toMatchObject({
      storeId: null,
      storeName: null,
      productId: null,
      productName: null,
    });
  });

  it.each([
    ['null', null],
    ['배열', [VALID]],
    ['refundId 숫자', { ...VALID, refundId: 11 }],
    ['buyerAccountId 누락', { ...VALID, buyerAccountId: undefined }],
    ['kind 모름', { ...VALID, kind: 'CHARGEBACK' }],
    ['amount 문자열', { ...VALID, amount: '30000' }],
  ])('반증: %s payload는 던진다', (_label, payload) => {
    expect(() =>
      parseRefundRequestedPayload(payload as Prisma.JsonValue),
    ).toThrow('payload 형식 오류');
  });
});
