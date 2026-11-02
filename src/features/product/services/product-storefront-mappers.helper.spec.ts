import type { StoreProductCategoryRow } from '@/features/product/repositories/product.repository';
import { toStoreProductCategory } from '@/features/product/services/product-storefront-mappers.helper';

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
