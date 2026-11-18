import {
  confirmedPaidAmount,
  settlementAmounts,
} from '@/features/order/repositories/order-settlement-finalizer.helper';

describe('order-settlement-finalizer.helper', () => {
  describe('settlementAmounts: 수수료 원 미만 버림', () => {
    it.each([
      // [기준액, bps, 수수료, 지급액]
      [10_000, 0, 0, 10_000],
      [10_000, 10_000, 10_000, 0],
      [10_000, 1_000, 1_000, 9_000],
      [10_001, 333, 333, 9_668], // 333.0333
      [3, 3_333, 0, 3], // 0.9999
      [3, 3_334, 1, 2], // 1.0002
      [1, 9_999, 0, 1], // 0.9999
      [29_999, 550, 1_649, 28_350], // 1649.945
      [4_294_967_295, 10_000, 4_294_967_295, 0], // INT UNSIGNED 상한에서도 정수 연산이 정확하다
    ])(
      '기준액 %d × %dbp → 수수료 %d, 지급액 %d',
      (base, bps, commission, payout) => {
        expect(settlementAmounts(base, bps)).toEqual({
          commissionAmount: commission,
          payoutAmount: payout,
        });
      },
    );
  });

  describe('confirmedPaidAmount', () => {
    it.each([
      ['결제 없음(결제 도입 전 주문)', null, 0],
      ['입금 대기', { amount: 30_000, confirmed_at: null }, 0],
      ['입금 확인', { amount: 30_000, confirmed_at: new Date() }, 30_000],
    ])('%s → %d', (_label, payment, expected) => {
      expect(confirmedPaidAmount(payment)).toBe(expected);
    });
  });
});
