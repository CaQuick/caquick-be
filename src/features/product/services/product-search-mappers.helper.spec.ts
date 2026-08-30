import {
  buildPriceBuckets,
  displayPrice,
} from '@/features/product/services/product-search-mappers.helper';

describe('product-search mappers', () => {
  describe('displayPrice', () => {
    it('할인가가 있으면 할인가, 없으면 정가', () => {
      expect(displayPrice({ regular_price: 40000, sale_price: 30000 })).toBe(
        30000,
      );
      expect(displayPrice({ regular_price: 40000, sale_price: null })).toBe(
        40000,
      );
    });
  });

  describe('buildPriceBuckets', () => {
    it('0~70,000을 5,000원 폭 14개 + "이상" 버킷 1개로 만들고 빈 구간도 0으로 채운다', () => {
      const buckets = buildPriceBuckets([]);

      expect(buckets).toHaveLength(15);
      expect(buckets[0]).toEqual({ minPrice: 0, maxPrice: 5000, count: 0 });
      expect(buckets[13]).toEqual({
        minPrice: 65000,
        maxPrice: 70000,
        count: 0,
      });
      expect(buckets[14]).toEqual({
        minPrice: 70000,
        maxPrice: null,
        count: 0,
      });
    });

    it('경계값은 상위 버킷에 속하고(5,000 → [5,000, 10,000)), 상한 이상은 마지막 버킷', () => {
      const buckets = buildPriceBuckets([4999, 5000, 69999, 70000, 120000]);

      expect(buckets[0].count).toBe(1);
      expect(buckets[1].count).toBe(1);
      expect(buckets[13].count).toBe(1);
      expect(buckets[14].count).toBe(2);
    });

    it('폭·상한을 바꿔도 마지막 버킷 상한이 max로 잘린다', () => {
      const buckets = buildPriceBuckets([7000], 3000, 7000);

      expect(buckets.map((b) => [b.minPrice, b.maxPrice])).toEqual([
        [0, 3000],
        [3000, 6000],
        [6000, 7000],
        [7000, null],
      ]);
      expect(buckets[3].count).toBe(1);
    });
  });
});
