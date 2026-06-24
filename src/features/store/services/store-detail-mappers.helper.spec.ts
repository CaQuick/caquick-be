import { Prisma } from '@prisma/client';

import type {
  StoreDetailRow,
  StoreReviewStat,
} from '@/features/store/repositories/store.repository';
import { toStoreDetail } from '@/features/store/services/store-detail-mappers.helper';

function makeRow(overrides: Partial<StoreDetailRow> = {}): StoreDetailRow {
  return {
    id: 1n,
    store_name: '해즈케이크',
    store_phone: '05930905934',
    address_full: '인천 서구 청라루비로 93',
    address_city: '인천광역시',
    address_neighborhood: '청라동',
    latitude: null,
    longitude: null,
    map_provider: 'NONE',
    business_hours_text: '10:00AM ~ 19:00PM',
    access_guide_text: '냉삼 꽃삼겹 골목으로 바로 들어오시면 있습니다.',
    regular_closure_text: '매주 2,4주 월요일 쉽니다',
    website_url: null,
    region: null,
    store_images: [],
    ...overrides,
  };
}

describe('toStoreDetail', () => {
  it('row를 StoreDetail로 매핑한다(id 문자열, 이미지 url 배열, 신규 필드 포함)', () => {
    const result = toStoreDetail(
      makeRow({
        store_images: [{ image_url: 'a.png' }, { image_url: 'b.png' }],
        website_url: 'https://store.example',
      }),
      undefined,
      false,
    );

    expect(result).toMatchObject({
      id: '1',
      storeName: '해즈케이크',
      phoneNumber: '05930905934',
      addressFull: '인천 서구 청라루비로 93',
      images: ['a.png', 'b.png'],
      mapProvider: 'NONE',
      businessHoursText: '10:00AM ~ 19:00PM',
      accessGuideText: '냉삼 꽃삼겹 골목으로 바로 들어오시면 있습니다.',
      regularClosureText: '매주 2,4주 월요일 쉽니다',
      websiteUrl: 'https://store.example',
    });
  });

  it('regionLabel: 시/동 우선, 없으면 region.name, 둘 다 없으면 null', () => {
    expect(
      toStoreDetail(
        makeRow({ address_city: '인천', address_neighborhood: '청라동' }),
        undefined,
        false,
      ).regionLabel,
    ).toBe('인천 청라동');

    expect(
      toStoreDetail(
        makeRow({
          address_city: null,
          address_neighborhood: null,
          region: { name: '서구' },
        }),
        undefined,
        false,
      ).regionLabel,
    ).toBe('서구');

    expect(
      toStoreDetail(
        makeRow({
          address_city: null,
          address_neighborhood: null,
          region: null,
        }),
        undefined,
        false,
      ).regionLabel,
    ).toBeNull();
  });

  it('평점은 소수 첫째 자리로 반올림하고 리뷰 수를 채운다', () => {
    const stat: StoreReviewStat = { average: 4.666, count: 122 };
    const result = toStoreDetail(makeRow(), stat, false);
    expect(result.ratingAverage).toBe(4.7);
    expect(result.reviewCount).toBe(122);
  });

  it('리뷰 통계가 없으면 평점 0, 리뷰 수 0', () => {
    const result = toStoreDetail(makeRow(), undefined, false);
    expect(result.ratingAverage).toBe(0);
    expect(result.reviewCount).toBe(0);
  });

  it('좌표 Decimal은 number로 변환하고 null은 유지한다', () => {
    const withCoord = toStoreDetail(
      makeRow({
        latitude: new Prisma.Decimal('37.5012'),
        longitude: new Prisma.Decimal('127.0396'),
      }),
      undefined,
      false,
    );
    expect(withCoord.latitude).toBeCloseTo(37.5012);
    expect(withCoord.longitude).toBeCloseTo(127.0396);

    const noCoord = toStoreDetail(makeRow(), undefined, false);
    expect(noCoord.latitude).toBeNull();
    expect(noCoord.longitude).toBeNull();
  });

  it('isWishlisted 인자를 그대로 반영한다', () => {
    expect(toStoreDetail(makeRow(), undefined, true).isWishlisted).toBe(true);
    expect(toStoreDetail(makeRow(), undefined, false).isWishlisted).toBe(false);
  });

  it('이미지가 없으면 빈 배열', () => {
    expect(
      toStoreDetail(makeRow({ store_images: [] }), undefined, false).images,
    ).toEqual([]);
  });
});
