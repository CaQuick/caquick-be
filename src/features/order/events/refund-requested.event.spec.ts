import {
  parseRefundAccountSubmittedPayload,
  REFUND_ACCOUNT_SUBMITTED,
  refundAccountSubmittedEvent,
} from '@/features/order/events/refund-account-submitted.event';
import {
  parseRefundCompletedPayload,
  REFUND_COMPLETED,
  refundCompletedEvent,
} from '@/features/order/events/refund-completed.event';
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
const occurredAt = new Date('2026-09-16T07:30:00.000Z');
const ARGS = {
  refundId: 11n,
  orderId: 7n,
  orderNumber: 'ORD-1',
  buyerAccountId: 3n,
  kind: 'CANCEL' as const,
  amount: 30_000,
  storeId: 2n,
  storeName: '케이크샵',
  productId: 5n,
  productName: '레터링 케이크',
  occurredAt,
  actorAccountId: 9n,
};

describe('refund.requested 이벤트', () => {
  it.each([true, false])(
    '주문과 같은 aggregate(파티션)에 묶고 파서가 그대로 읽는다(계좌 입력 %s)',
    (accountSubmitted) => {
      const event = refundRequestedEvent({ ...ARGS, accountSubmitted });

      expect(event).toEqual({
        aggregateType: 'order',
        aggregateId: '7',
        eventType: REFUND_REQUESTED,
        payload: { ...VALID, accountSubmitted },
        occurredAt,
        actorAccountId: 9n,
      });
      expect(
        parseRefundRequestedPayload(event.payload as Prisma.JsonValue),
      ).toEqual({ ...VALID, accountSubmitted });
    },
  );

  it('계좌 입력 여부가 없던 이벤트는 false로 읽는다', () => {
    expect(parseRefundRequestedPayload(VALID).accountSubmitted).toBe(false);
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
    ).toThrow('refund.requested payload 형식 오류');
  });
});

describe.each([
  [
    REFUND_ACCOUNT_SUBMITTED,
    refundAccountSubmittedEvent,
    parseRefundAccountSubmittedPayload,
  ],
  [REFUND_COMPLETED, refundCompletedEvent, parseRefundCompletedPayload],
] as const)('%s 이벤트', (eventType, build, parse) => {
  it('같은 공통 payload로 주문 파티션에 싣고 파서가 그대로 읽는다', () => {
    const event = build(ARGS);

    expect(event).toMatchObject({
      aggregateType: 'order',
      aggregateId: '7',
      eventType,
      payload: VALID,
    });
    expect(parse(event.payload as Prisma.JsonValue)).toEqual(VALID);
  });

  it('반증: 형식이 틀리면 이벤트 이름과 함께 던진다', () => {
    expect(() => parse({ ...VALID, amount: '1' })).toThrow(
      `${eventType} payload 형식 오류`,
    );
  });
});
