import {
  ORDER_CONFIRM_REMINDER_DUE,
  orderConfirmReminderDueEvent,
  parseOrderConfirmReminderDuePayload,
} from '@/features/order/events/order-confirm-reminder-due.event';
import type { Prisma } from '@/generated/prisma/client';

const VALID = {
  orderId: '7',
  orderNumber: 'ORD-20261119-ABC234',
  storeId: '5',
  productName: '딸기 케이크',
  confirmDeadlineAt: '2026-11-19T09:00:00.000Z',
};

describe('order.confirm_reminder_due 이벤트', () => {
  it('bigint·Date를 문자열로 싣고 order aggregate에 묶는다(시스템 발행이라 행위자 없음)', () => {
    const occurredAt = new Date('2026-11-19T07:00:00.000Z');
    const event = orderConfirmReminderDueEvent({
      orderId: 7n,
      orderNumber: VALID.orderNumber,
      storeId: 5n,
      productName: VALID.productName,
      confirmDeadlineAt: new Date(VALID.confirmDeadlineAt),
      occurredAt,
    });

    expect(event).toEqual({
      aggregateType: 'order',
      aggregateId: '7',
      eventType: ORDER_CONFIRM_REMINDER_DUE,
      payload: VALID,
      occurredAt,
      actorAccountId: null,
    });
    expect(
      parseOrderConfirmReminderDuePayload(event.payload as Prisma.JsonValue),
    ).toEqual(VALID);
  });

  it.each([
    ['배열', []],
    ['null', null],
    ['매장 누락', { ...VALID, storeId: undefined }],
    ['마감 비ISO', { ...VALID, confirmDeadlineAt: 'not-a-date' }],
    ['상품명 숫자', { ...VALID, productName: 3 }],
  ])('%s payload는 던진다', (_label, value) => {
    expect(() =>
      parseOrderConfirmReminderDuePayload(value as Prisma.JsonValue),
    ).toThrow('order.confirm_reminder_due payload 형식 오류');
  });
});
