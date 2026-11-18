import {
  ORDER_STATUS_CHANGED,
  orderStatusChangedEvent,
  parseOrderStatusChangedPayload,
} from '@/features/order/events/order-status-changed.event';
import type { Prisma } from '@/generated/prisma/client';

const LEGACY = {
  orderId: '7',
  orderNumber: 'ORD-1',
  buyerAccountId: '3',
  fromStatus: 'CONFIRMED',
  toStatus: 'CANCELED',
  storeId: '2',
  storeName: '케이크샵',
  productId: '5',
  productName: '레터링 케이크',
};
const VALID = {
  ...LEGACY,
  actorType: 'ADMIN',
  cancelReason: 'OUT_OF_MATERIALS',
  refundAmount: 10_000,
  pickupAt: '2026-09-20T03:00:00.000Z',
};

describe('order.status_changed 이벤트', () => {
  it('취소 주체·사유·환불액·픽업 일시를 싣고 파서가 그대로 읽는다', () => {
    const occurredAt = new Date('2026-09-16T07:30:00.000Z');
    const event = orderStatusChangedEvent({
      orderId: 7n,
      orderNumber: 'ORD-1',
      buyerAccountId: 3n,
      fromStatus: 'CONFIRMED',
      toStatus: 'CANCELED',
      storeId: 2n,
      storeName: '케이크샵',
      productId: 5n,
      productName: '레터링 케이크',
      actorType: 'ADMIN',
      pickupAt: new Date(VALID.pickupAt),
      cancelReason: 'OUT_OF_MATERIALS',
      refundAmount: 10_000,
      occurredAt,
      actorAccountId: 9n,
    });

    expect(event).toMatchObject({
      aggregateId: '7',
      eventType: ORDER_STATUS_CHANGED,
      payload: VALID,
    });
    expect(
      parseOrderStatusChangedPayload(event.payload as Prisma.JsonValue),
    ).toEqual(VALID);
  });

  it('취소가 아닌 전이는 사유·환불액이 null이다', () => {
    const event = orderStatusChangedEvent({
      orderId: 7n,
      orderNumber: 'ORD-1',
      buyerAccountId: 3n,
      fromStatus: 'SUBMITTED',
      toStatus: 'CONFIRMED',
      storeId: null,
      storeName: null,
      productId: null,
      productName: null,
      actorType: 'SELLER',
      pickupAt: new Date(VALID.pickupAt),
      occurredAt: new Date(),
      actorAccountId: null,
    });
    expect(event.payload).toMatchObject({
      actorType: 'SELLER',
      cancelReason: null,
      refundAmount: null,
    });
  });

  it('새 필드가 없는 옛 이벤트는 null로 읽는다', () => {
    expect(parseOrderStatusChangedPayload(LEGACY as Prisma.JsonValue)).toEqual({
      ...LEGACY,
      actorType: null,
      cancelReason: null,
      refundAmount: null,
      pickupAt: null,
    });
  });

  it.each([
    ['null', null],
    ['배열', [VALID]],
    ['fromStatus 모름', { ...VALID, fromStatus: 'SHIPPED' }],
    ['toStatus 누락', { ...VALID, toStatus: undefined }],
    ['actorType 모름', { ...VALID, actorType: 'ROBOT' }],
    ['cancelReason 모름', { ...VALID, cancelReason: 'WHATEVER' }],
    ['refundAmount 문자열', { ...VALID, refundAmount: '10000' }],
    ['refundAmount 소수', { ...VALID, refundAmount: 1.5 }],
    ['pickupAt 날짜 아님', { ...VALID, pickupAt: 'tomorrow' }],
  ])('반증: %s payload는 던진다', (_label, payload) => {
    expect(() =>
      parseOrderStatusChangedPayload(payload as Prisma.JsonValue),
    ).toThrow('payload 형식 오류');
  });
});
