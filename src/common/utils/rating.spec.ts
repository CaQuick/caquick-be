import { roundRatingAverage } from '@/common/utils/rating';

describe('roundRatingAverage', () => {
  it('소수 첫째 자리로 반올림한다', () => {
    expect(roundRatingAverage(4.666)).toBe(4.7);
    expect(roundRatingAverage(4.64)).toBe(4.6);
    expect(roundRatingAverage(4.65)).toBe(4.7);
  });

  it('0과 정수는 그대로 유지한다', () => {
    expect(roundRatingAverage(0)).toBe(0);
    expect(roundRatingAverage(5)).toBe(5);
  });
});
