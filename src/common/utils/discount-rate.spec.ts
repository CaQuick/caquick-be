import { calcDiscountRate } from '@/common/utils/discount-rate';

describe('calcDiscountRate', () => {
  it.each<[string, number, number | null, number]>([
    ['정수로 반올림(12.5→13)', 40000, 35000, 13],
    ['정상 할인', 33000, 31350, 5],
    ['판매가 null', 40000, null, 0],
    ['판매가 = 정가', 40000, 40000, 0],
    ['판매가 > 정가', 40000, 45000, 0],
    ['정가 0', 0, 0, 0],
    ['음수 판매가는 100에 clamp', 40000, -10000, 100],
  ])('%s', (_case, regular, sale, expected) => {
    expect(calcDiscountRate(regular, sale)).toBe(expected);
  });
});
