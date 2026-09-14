import {
  type ProductCardFields,
  toProductCardCore,
} from '@/features/product/services/product-card.helper';

describe('toProductCardCore', () => {
  function makeProduct(
    overrides: Partial<ProductCardFields> = {},
  ): ProductCardFields {
    return {
      store_id: 7n,
      name: '딸기 케이크',
      regular_price: 40000,
      sale_price: 30000,
      store: {
        store_name: '케이크샵',
        address_city: '서울',
        address_neighborhood: '청담동',
        region: { name: '강남구' },
      },
      images: [{ image_url: 'https://cdn/a.jpg' }],
      ...overrides,
    };
  }

  it('bigint id를 문자열로 바꾼다', () => {
    const card = toProductCardCore(123n, makeProduct());
    expect(card.id).toBe('123');
    expect(card.storeId).toBe('7');
  });

  // 조인 행(찜·최근 본 상품)은 상품 id가 바깥에 있어 id를 따로 받는다
  it('id는 인자로 받은 값을 쓴다 (product 안의 값이 아니다)', () => {
    expect(toProductCardCore(0n, makeProduct()).id).toBe('0');
  });

  it('대표 이미지는 첫 행, 없으면 null', () => {
    expect(toProductCardCore(1n, makeProduct()).thumbnailUrl).toBe(
      'https://cdn/a.jpg',
    );
    expect(
      toProductCardCore(1n, makeProduct({ images: [] })).thumbnailUrl,
    ).toBeNull();
  });

  it('할인율은 정가·할인가에서 계산하고, 할인가가 없으면 0', () => {
    expect(toProductCardCore(1n, makeProduct()).discountRate).toBe(25);
    expect(
      toProductCardCore(1n, makeProduct({ sale_price: null })).discountRate,
    ).toBe(0);
  });

  it.each([
    [
      '시·동이 있으면 둘을 잇는다',
      { address_city: '서울', address_neighborhood: '청담동' },
      '서울 청담동',
    ],
    [
      '한쪽만 있으면 그것만',
      { address_city: null, address_neighborhood: '청담동' },
      '청담동',
    ],
    [
      '주소가 비면 지역명으로 떨어진다',
      { address_city: null, address_neighborhood: null },
      '강남구',
    ],
  ])('지역 표기: %s', (_label, address, expected) => {
    const card = toProductCardCore(
      1n,
      makeProduct({
        store: {
          store_name: '케이크샵',
          region: { name: '강남구' },
          ...address,
        },
      }),
    );
    expect(card.regionLabel).toBe(expected);
  });

  it('주소도 지역도 없으면 regionLabel은 null', () => {
    const card = toProductCardCore(
      1n,
      makeProduct({
        store: {
          store_name: '케이크샵',
          address_city: null,
          address_neighborhood: null,
          region: null,
        },
      }),
    );
    expect(card.regionLabel).toBeNull();
  });
});
