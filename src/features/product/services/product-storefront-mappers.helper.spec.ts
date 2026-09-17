import type { StoreProductCategoryRow } from '@/features/product/repositories/product.repository';
import {
  calcDiscountRate,
  toStoreProductCategory,
} from '@/features/product/services/product-storefront-mappers.helper';

describe('calcDiscountRate', () => {
  it('정상 할인율을 정수로 반올림한다', () => {
    expect(calcDiscountRate(40000, 35000)).toBe(13); // 12.5 → 13
    expect(calcDiscountRate(33000, 31350)).toBe(5);
  });

  it('salePrice가 null이면 0', () => {
    expect(calcDiscountRate(40000, null)).toBe(0);
  });

  it('salePrice가 정가 이상이면 0', () => {
    expect(calcDiscountRate(40000, 40000)).toBe(0);
    expect(calcDiscountRate(40000, 45000)).toBe(0);
  });

  it('정가가 0 이하이면 0', () => {
    expect(calcDiscountRate(0, 0)).toBe(0);
  });

  it('salePrice가 음수 등 비정상이면 0~100으로 clamp한다', () => {
    expect(calcDiscountRate(40000, -10000)).toBe(100);
  });
});

describe('toStoreProductCategory', () => {
  it('카테고리 row를 매핑한다', () => {
    const row: StoreProductCategoryRow = {
      id: 5n,
      name: '생일 케이크',
      category_type: 'EVENT',
      sort_order: 2,
      product_count: 7,
    };
    expect(toStoreProductCategory(row)).toEqual({
      id: '5',
      name: '생일 케이크',
      categoryType: 'EVENT',
      sortOrder: 2,
      productCount: 7,
    });
  });
});
