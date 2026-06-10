import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpdateBannerInput } from '@/features/seller/dto/inputs/seller-update-banner.input';

function build(plain: object): SellerUpdateBannerInput {
  return plainToInstance(SellerUpdateBannerInput, plain);
}

describe('SellerUpdateBannerInput', () => {
  it('bannerId 만 있어도 통과', async () => {
    const dto = build({ bannerId: '1' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('일부 필드 수정 통과', async () => {
    const dto = build({
      bannerId: '1',
      title: 'updated',
      isActive: false,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('bannerId 누락 거절', async () => {
    const dto = build({ title: 'x' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('bannerId');
  });

  it('알 수 없는 placement 거절', async () => {
    const dto = build({ bannerId: '1', placement: 'INVALID' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('placement');
  });

  it.each([
    ['title', { title: 12345 }, 'title'],
    ['imageUrl 문자열 아님', { imageUrl: 12345 }, 'imageUrl'],
    ['알 수 없는 linkType', { linkType: 'UNKNOWN' }, 'linkType'],
    ['linkUrl', { linkUrl: 12345 }, 'linkUrl'],
    ['linkProductId', { linkProductId: 12345 }, 'linkProductId'],
    ['linkStoreId', { linkStoreId: 12345 }, 'linkStoreId'],
    ['linkCategoryId', { linkCategoryId: 12345 }, 'linkCategoryId'],
    ['startsAt 가 Date 아님', { startsAt: '2026-06-01' }, 'startsAt'],
    ['endsAt 가 Date 아님', { endsAt: '2026-06-01' }, 'endsAt'],
    ['sortOrder 가 정수 아님', { sortOrder: 1.5 }, 'sortOrder'],
    ['isActive 가 boolean 아님', { isActive: 'true' }, 'isActive'],
  ])(
    '각 선택 필드 타입 오류 거절: %s',
    async (_label, override, expectedProp) => {
      const dto = build({ bannerId: '1', ...override });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === expectedProp)).toBe(true);
    },
  );

  it('link* 가 null 이어도 통과', async () => {
    const dto = build({
      bannerId: '1',
      linkProductId: null,
      linkStoreId: null,
      linkCategoryId: null,
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
