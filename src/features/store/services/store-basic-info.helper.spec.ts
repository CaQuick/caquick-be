import { buildStoreBasicInfoUpdateData } from '@/features/store/services/store-basic-info.helper';
import { Prisma } from '@/generated/prisma/client';

describe('buildStoreBasicInfoUpdateData', () => {
  it('빈 입력이면 빈 update 데이터', () => {
    expect(buildStoreBasicInfoUpdateData({})).toEqual({});
  });

  it('전달한 필드만 컬럼으로 옮기고 공백은 정리한다', () => {
    const data = buildStoreBasicInfoUpdateData({
      storeName: '  가게  ',
      storePhone: '02-1',
      addressCity: '  서울  ',
      latitude: ' 37.5 ',
      mapProvider: 'NAVER',
    });
    expect(data.store_name).toBe('가게');
    expect(data.store_phone).toBe('02-1');
    expect(data.address_city).toBe('서울');
    expect(data.latitude).toEqual(new Prisma.Decimal('37.5'));
    expect(data.map_provider).toBe('NAVER');
    expect('address_full' in data).toBe(false);
  });

  // nullable 컬럼 전수: null/빈 문자열 → null(제거), undefined → 키 없음(유지)
  it.each([
    ['addressCity', 'address_city'],
    ['addressDistrict', 'address_district'],
    ['addressNeighborhood', 'address_neighborhood'],
    ['websiteUrl', 'website_url'],
    ['businessHoursText', 'business_hours_text'],
    ['profileImageUrl', 'profile_image_url'],
    ['greetingMessage', 'greeting_message'],
    ['latitude', 'latitude'],
    ['longitude', 'longitude'],
  ] as const)('%s: null·빈 문자열은 제거, 미전달은 유지', (field, column) => {
    expect(buildStoreBasicInfoUpdateData({ [field]: null })).toEqual({
      [column]: null,
    });
    expect(buildStoreBasicInfoUpdateData({ [field]: '' })).toEqual({
      [column]: null,
    });
    expect(buildStoreBasicInfoUpdateData({ [field]: undefined })).toEqual({});
  });

  it('mapProvider null은 유지로 본다(non-null 컬럼)', () => {
    expect(buildStoreBasicInfoUpdateData({ mapProvider: null })).toEqual({});
  });

  it.each(['storeName', 'storePhone', 'addressFull'] as const)(
    '필수 %s가 공백이면 BadRequestException',
    (field) => {
      expect(() =>
        buildStoreBasicInfoUpdateData({ [field]: '   ' }),
      ).toThrowDomain(400);
    },
  );

  it.each([
    ['숫자 아님', { longitude: 'east' }],
    ['NaN', { latitude: 'NaN' }],
    ['위도 범위 밖', { latitude: '-90.5' }],
    ['경도 범위 밖', { longitude: '181' }],
  ])('좌표 %s이면 BadRequestException', (_label, coords) => {
    expect(() => buildStoreBasicInfoUpdateData(coords)).toThrowDomain(400);
  });

  it('길이 초과는 400', () => {
    expect(() =>
      buildStoreBasicInfoUpdateData({ storeName: 'n'.repeat(201) }),
    ).toThrowDomain(400);
  });
});
