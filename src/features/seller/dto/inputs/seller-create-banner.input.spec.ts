import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerCreateBannerInput } from '@/features/seller/dto/inputs/seller-create-banner.input';

function build(plain: object): SellerCreateBannerInput {
  return plainToInstance(SellerCreateBannerInput, plain);
}

describe('SellerCreateBannerInput', () => {
  it('필수만 통과', async () => {
    const dto = build({ placement: 'HOME_MAIN', imageUrl: 'https://x/y.jpg' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('전체 필드 통과', async () => {
    const dto = build({
      placement: 'CATEGORY',
      title: '여름 배너',
      imageUrl: 'https://x/y.jpg',
      linkType: 'URL',
      linkUrl: 'https://caquick.site/promo',
      startsAt: new Date('2026-06-01'),
      endsAt: new Date('2026-08-31'),
      sortOrder: 1,
      isActive: true,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('placement 누락 거절', async () => {
    const dto = build({ imageUrl: 'https://x/y.jpg' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('placement');
  });

  it('imageUrl 누락 거절', async () => {
    const dto = build({ placement: 'HOME_MAIN' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('imageUrl');
  });

  it('알 수 없는 placement 거절', async () => {
    const dto = build({ placement: 'INVALID', imageUrl: 'https://x/y.jpg' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('placement');
  });

  it('알 수 없는 linkType 거절', async () => {
    const dto = build({
      placement: 'HOME_MAIN',
      imageUrl: 'https://x/y.jpg',
      linkType: 'UNKNOWN',
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('linkType');
  });

  it('startsAt 가 Date 가 아니면 거절', async () => {
    const dto = build({
      placement: 'HOME_MAIN',
      imageUrl: 'https://x/y.jpg',
      startsAt: '2026-06-01',
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('startsAt');
  });

  it.each([
    ['title', { title: 12345 }, 'title'],
    ['imageUrl 가 문자열 아님', { imageUrl: 12345 }, 'imageUrl'],
    ['linkUrl', { linkUrl: 12345 }, 'linkUrl'],
    ['linkProductId', { linkProductId: 12345 }, 'linkProductId'],
    ['linkStoreId', { linkStoreId: 12345 }, 'linkStoreId'],
    ['linkCategoryId', { linkCategoryId: 12345 }, 'linkCategoryId'],
    ['endsAt', { endsAt: '2026-06-01' }, 'endsAt'],
    ['sortOrder 가 정수 아님', { sortOrder: 1.5 }, 'sortOrder'],
    ['isActive 가 boolean 아님', { isActive: 'true' }, 'isActive'],
  ])(
    '각 선택 필드 타입 오류 거절: %s',
    async (_label, override, expectedProp) => {
      const base = { placement: 'HOME_MAIN', imageUrl: 'https://x/y.jpg' };
      const dto = build({ ...base, ...override });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === expectedProp)).toBe(true);
    },
  );

  it('linkProductId · linkStoreId · linkCategoryId 가 null 이어도 통과 (IsOptional 흡수)', async () => {
    // FE 가 명시적 null 을 보낼 수 있으므로 허용. linkType 별 조합 검증은 service.
    const dto = build({
      placement: 'STORE',
      imageUrl: 'https://x/y.jpg',
      linkType: 'STORE',
      linkProductId: null,
      linkStoreId: null,
      linkCategoryId: null,
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
