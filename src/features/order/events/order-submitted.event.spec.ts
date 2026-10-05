import {
  ORDER_SUBMITTED,
  orderSubmittedEvent,
  parseOrderSubmittedPayload,
} from '@/features/order/events/order-submitted.event';
import type { Prisma } from '@/generated/prisma/client';

const VALID = {
  orderId: '7',
  orderNumber: 'ORD-20260916-ABC234',
  buyerAccountId: '3',
  storeId: '5',
  storeName: '해즈 케이크',
  productId: '9',
  productName: '딸기 케이크',
  quantity: 2,
  pickupAt: '2026-09-18T05:00:00.000Z',
  totalPrice: 56000,
};

describe('order.submitted 이벤트', () => {
  it('bigint·Date를 문자열로 싣고 order aggregate(상태 전이와 같은 파티션)에 묶는다', () => {
    const occurredAt = new Date('2026-09-16T07:00:00.000Z');
    const event = orderSubmittedEvent({
      orderId: 7n,
      orderNumber: VALID.orderNumber,
      buyerAccountId: 3n,
      storeId: 5n,
      storeName: VALID.storeName,
      productId: 9n,
      productName: VALID.productName,
      quantity: 2,
      pickupAt: new Date(VALID.pickupAt),
      totalPrice: 56000,
      occurredAt,
    });

    expect(event).toEqual({
      aggregateType: 'order',
      aggregateId: '7',
      eventType: ORDER_SUBMITTED,
      payload: VALID,
      occurredAt,
      actorAccountId: 3n,
    });
    expect(
      parseOrderSubmittedPayload(event.payload as Prisma.JsonValue),
    ).toEqual(VALID);
  });

  it.each([
    ['null', null],
    ['배열', [VALID]],
    ['문자열', 'x'],
    ['orderId 누락', { ...VALID, orderId: undefined }],
    ['orderId 숫자', { ...VALID, orderId: 7 }],
    ['orderNumber 누락', { ...VALID, orderNumber: undefined }],
    ['buyerAccountId 숫자', { ...VALID, buyerAccountId: 3 }],
    ['storeId null', { ...VALID, storeId: null }],
    ['storeName 누락', { ...VALID, storeName: undefined }],
    ['productId 누락', { ...VALID, productId: undefined }],
    ['productName null', { ...VALID, productName: null }],
    ['quantity 문자열', { ...VALID, quantity: '2' }],
    ['quantity 소수', { ...VALID, quantity: 1.5 }],
    ['pickupAt 숫자', { ...VALID, pickupAt: 1_700_000_000 }],
    ['pickupAt 비ISO', { ...VALID, pickupAt: 'not-a-date' }],
    ['totalPrice 문자열', { ...VALID, totalPrice: '56000' }],
  ])('반증: %s payload는 던진다', (_label, payload) => {
    expect(() =>
      parseOrderSubmittedPayload(
        payload as Parameters<typeof parseOrderSubmittedPayload>[0],
      ),
    ).toThrow('payload 형식 오류');
  });
});
