import { toOrderSettlementFields } from '@/features/order/services/order-settlement-mappers.helper';

const CONFIRMED_AT = new Date('2026-11-12T05:00:00.000Z');
const paid = (amount: number) => ({ amount, confirmed_at: CONFIRMED_AT });

describe('toOrderSettlementFields — 정산 예정 금액', () => {
  it.each([
    ['결제 도입 전', 'CONFIRMED', null, null, null, null],
    [
      '입금 대기(미확인 결제)',
      'PENDING_PAYMENT',
      { amount: 10_000, confirmed_at: null },
      null,
      null,
      null,
    ],
    ['확정 전: 결제액 − 수수료', 'CONFIRMED', paid(10_000), null, null, 9_445],
    [
      '확정 전 원 미만 버림(10001 × 5.55% = 555.05)',
      'MADE',
      paid(10_001),
      null,
      null,
      9_446,
    ],
    ['확정 없이 취소(전액 환불)', 'CANCELED', paid(10_000), null, null, 0],
    [
      '구매자 사정 취소 확정: 남은 금액 기준',
      'CANCELED',
      paid(10_000),
      4_000,
      222,
      3_778,
    ],
    ['픽업 완료 확정', 'PICKED_UP', paid(10_000), 10_000, 555, 9_445],
  ] as const)('%s', (_label, status, payment, base, commission, expected) => {
    const fields = toOrderSettlementFields({
      status,
      commission_rate_bps: 555,
      settlement_base_amount: base,
      commission_amount: commission,
      payment,
    });
    expect(fields).toEqual({
      commissionRateBps: 555,
      expectedPayoutAmount: expected,
      settlementBaseAmount: base,
      commissionAmount: commission,
    });
  });
});
