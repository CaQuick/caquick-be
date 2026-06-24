import type {
  StoreProductCategoryRow,
  StoreProductRow,
} from '@/features/product/repositories/product.repository';
import {
  calcDiscountRate,
  toStoreProduct,
  toStoreProductCategory,
} from '@/features/product/services/product-storefront-mappers.helper';

function makeProductRow(o: Partial<StoreProductRow> = {}): StoreProductRow {
  return {
    id: 1n,
    name: '레터링 케이크',
    description: '설명',
    regular_price: 40000,
    sale_price: 35000,
    currency: 'KRW',
    images: [{ image_url: 'thumb.png' }],
    product_categories: [{ category_id: 10n }, { category_id: 20n }],
    ...o,
  };
}

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

describe('toStoreProduct', () => {
  it('row를 카드로 매핑한다(id 문자열·대표이미지·할인율·카테고리ids)', () => {
    const result = toStoreProduct(makeProductRow());
    expect(result).toEqual({
      id: '1',
      name: '레터링 케이크',
      description: '설명',
      thumbnailUrl: 'thumb.png',
      regularPrice: 40000,
      salePrice: 35000,
      discountRate: 13,
      currency: 'KRW',
      categoryIds: ['10', '20'],
    });
  });

  it('이미지가 없으면 thumbnailUrl은 null', () => {
    expect(
      toStoreProduct(makeProductRow({ images: [] })).thumbnailUrl,
    ).toBeNull();
  });

  it('salePrice가 없으면 discountRate는 0', () => {
    const r = toStoreProduct(makeProductRow({ sale_price: null }));
    expect(r.salePrice).toBeNull();
    expect(r.discountRate).toBe(0);
  });

  it('카테고리가 없으면 categoryIds는 빈 배열', () => {
    expect(
      toStoreProduct(makeProductRow({ product_categories: [] })).categoryIds,
    ).toEqual([]);
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
