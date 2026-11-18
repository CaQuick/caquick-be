import {
  parseSettlementCreatedPayload,
  SETTLEMENT_CREATED,
  settlementCreatedEvent,
} from '@/features/order/events/settlement-created.event';
import type { Prisma } from '@/generated/prisma/client';

const VALID = {
  settlementId: '5',
  storeId: '9',
  storeName: '해즈 케이크',
  periodStart: '2026-11-09',
  periodEnd: '2026-11-15',
  orderCount: 3,
  settlementBaseAmount: 90_000,
  commissionAmount: 4_995,
  payoutAmount: 85_005,
};

describe('settlement.created 이벤트', () => {
  it('정산 단위 aggregate에 묶고 시스템 행위(행위자 없음)다', () => {
    const occurredAt = new Date('2026-11-15T20:00:00.000Z');
    const event = settlementCreatedEvent(VALID, occurredAt);

    expect(event).toEqual({
      aggregateType: 'settlement',
      aggregateId: '5',
      eventType: SETTLEMENT_CREATED,
      payload: VALID,
      occurredAt,
      actorAccountId: null,
    });
    expect(
      parseSettlementCreatedPayload(event.payload as Prisma.JsonValue),
    ).toEqual(VALID);
  });

  it.each([
    ['null', null],
    ['배열', [VALID]],
    ['settlementId 숫자', { ...VALID, settlementId: 5 }],
    ['storeName 누락', { ...VALID, storeName: undefined }],
    [
      'periodStart 시각 형식',
      { ...VALID, periodStart: '2026-11-09T00:00:00Z' },
    ],
    ['periodEnd 누락', { ...VALID, periodEnd: undefined }],
    ['orderCount 문자열', { ...VALID, orderCount: '3' }],
    ['payoutAmount 소수', { ...VALID, payoutAmount: 1.5 }],
  ])('반증: %s payload는 던진다', (_label, payload) => {
    expect(() =>
      parseSettlementCreatedPayload(payload as Prisma.JsonValue),
    ).toThrow('payload 형식 오류');
  });
});
