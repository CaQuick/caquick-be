import type { StoreCandidateRow } from '@/features/store/repositories/store.repository';
import {
  buildRegionLabel,
  toPopularStore,
} from '@/features/store/services/store-mappers.helper';

function row(overrides: Partial<StoreCandidateRow>): StoreCandidateRow {
  return {
    id: 1n,
    store_name: '매장',
    address_city: null,
    address_neighborhood: null,
    region: null,
    ...overrides,
  };
}

describe('store-mappers.helper', () => {
  describe('buildRegionLabel', () => {
    it('시/동이 있으면 조합해서 표기한다', () => {
      expect(
        buildRegionLabel(
          row({ address_city: '서울특별시', address_neighborhood: '역삼동' }),
        ),
      ).toBe('서울특별시 역삼동');
    });

    it('일부만 있으면 있는 값만 표기한다', () => {
      expect(buildRegionLabel(row({ address_neighborhood: '역삼동' }))).toBe(
        '역삼동',
      );
    });

    it('주소가 없으면 2차 지역명으로 대체한다', () => {
      expect(buildRegionLabel(row({ region: { name: '강남구' } }))).toBe(
        '강남구',
      );
    });

    it('주소도 지역도 없으면 null', () => {
      expect(buildRegionLabel(row({}))).toBeNull();
    });
  });

  describe('toPopularStore', () => {
    it('평점을 소수 첫째 자리로 반올림하고 rank·이미지를 매핑한다', () => {
      const result = toPopularStore(
        row({ id: 7n, store_name: '케이크하우스' }),
        {
          recentOrderCount: 3,
          wishlistCount: 2,
          ratingAverage: 4.666,
          reviewCount: 9,
        },
        1,
        ['a.png', 'b.png'],
      );

      expect(result).toMatchObject({
        id: '7',
        rank: 1,
        storeName: '케이크하우스',
        ratingAverage: 4.7,
        reviewCount: 9,
        cakeImageUrls: ['a.png', 'b.png'],
      });
    });
  });
});
