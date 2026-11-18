import {
  ORDER_PICKUP_RESCHEDULED,
  orderPickupRescheduledEvent,
  parseOrderPickupRescheduledPayload,
} from '@/features/order/events/order-pickup-rescheduled.event';
import type { Prisma } from '@/generated/prisma/client';

const VALID = {
  orderId: '7',
  orderNumber: 'ORD-20261119-ABC234',
  buyerAccountId: '3',
  storeId: '5',
  storeName: '해즈 케이크',
  productId: '9',
  productName: '딸기 케이크',
  fromPickupAt: '2026-11-20T05:00:00.000Z',
  toPickupAt: '2026-11-21T06:30:00.000Z',
};

describe('order.pickup_rescheduled 이벤트', () => {
  it('bigint·Date를 문자열로 싣고 order aggregate에 묶고 행위자는 판매자다', () => {
    const occurredAt = new Date('2026-11-19T07:00:00.000Z');
    const event = orderPickupRescheduledEvent({
      orderId: 7n,
      orderNumber: VALID.orderNumber,
      buyerAccountId: 3n,
      storeId: 5n,
      storeName: VALID.storeName,
      productId: 9n,
      productName: VALID.productName,
      fromPickupAt: new Date(VALID.fromPickupAt),
      toPickupAt: new Date(VALID.toPickupAt),
      occurredAt,
      actorAccountId: 11n,
    });

    expect(event).toEqual({
      aggregateType: 'order',
      aggregateId: '7',
      eventType: ORDER_PICKUP_RESCHEDULED,
      payload: VALID,
      occurredAt,
      actorAccountId: 11n,
    });
    expect(
      parseOrderPickupRescheduledPayload(event.payload as Prisma.JsonValue),
    ).toEqual(VALID);
  });

  it('품목이 없던 주문의 매장·상품은 null로 읽는다', () => {
    expect(
      parseOrderPickupRescheduledPayload({
        ...VALID,
        storeId: null,
        storeName: null,
        productId: null,
        productName: null,
      }),
    ).toMatchObject({ storeId: null, productName: null });
  });

  it.each([
    ['배열', []],
    ['구매자 누락', { ...VALID, buyerAccountId: undefined }],
    ['변경 후 시각 비ISO', { ...VALID, toPickupAt: 'not-a-date' }],
    ['변경 전 시각 숫자', { ...VALID, fromPickupAt: 1_700_000_000 }],
  ])('%s payload는 던진다', (_label, value) => {
    expect(() =>
      parseOrderPickupRescheduledPayload(value as Prisma.JsonValue),
    ).toThrow('order.pickup_rescheduled payload 형식 오류');
  });
});
