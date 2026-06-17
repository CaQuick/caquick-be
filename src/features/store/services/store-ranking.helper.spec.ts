import { RANKING_BAYESIAN_M } from '@/features/store/constants/store-ranking.constants';
import {
  bayesianRating,
  popularityScore,
} from '@/features/store/services/store-ranking.helper';

describe('store-ranking.helper', () => {
  describe('bayesianRating', () => {
    it('리뷰가 없으면 globalAverage를 그대로 반환한다', () => {
      expect(bayesianRating(5, 0, 4.0)).toBe(4.0);
    });

    it('count = m이면 실제 평균과 prior의 중간값', () => {
      // (5*5 + 5*3) / (5+5) = 4.0
      expect(bayesianRating(5, RANKING_BAYESIAN_M, 3.0)).toBeCloseTo(4.0);
    });

    it('리뷰가 많을수록 실제 평균에 수렴한다', () => {
      const few = bayesianRating(5, 1, 3.0);
      const many = bayesianRating(5, 200, 3.0);
      expect(many).toBeGreaterThan(few);
      expect(many).toBeLessThanOrEqual(5);
    });
  });

  describe('popularityScore', () => {
    it('주문·찜·평점이 높을수록 점수가 높다', () => {
      const low = popularityScore(
        {
          recentOrderCount: 0,
          wishlistCount: 0,
          ratingAverage: 0,
          reviewCount: 0,
        },
        4.0,
      );
      const high = popularityScore(
        {
          recentOrderCount: 100,
          wishlistCount: 50,
          ratingAverage: 5,
          reviewCount: 50,
        },
        4.0,
      );
      expect(high).toBeGreaterThan(low);
    });

    it('주문 수 기여는 ln으로 체감한다(동일 증가량의 한계효용 감소)', () => {
      const base = { wishlistCount: 0, ratingAverage: 0, reviewCount: 0 };
      const at0 = popularityScore({ ...base, recentOrderCount: 0 }, 0);
      const at10 = popularityScore({ ...base, recentOrderCount: 10 }, 0);
      const at100 = popularityScore({ ...base, recentOrderCount: 100 }, 0);
      const at110 = popularityScore({ ...base, recentOrderCount: 110 }, 0);
      // 같은 +10 증가라도 낮은 구간(0→10)의 상승폭이 높은 구간(100→110)보다 크다
      expect(at10 - at0).toBeGreaterThan(at110 - at100);
    });
  });
});
