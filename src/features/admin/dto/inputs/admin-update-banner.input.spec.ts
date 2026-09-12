import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminUpdateBannerInput } from '@/features/admin/dto/inputs/admin-update-banner.input';

function build(plain: object): AdminUpdateBannerInput {
  return plainToInstance(AdminUpdateBannerInput, plain);
}

describe('AdminUpdateBannerInput', () => {
  it('bannerId만 있는 부분 수정 통과', async () => {
    expect(await validate(build({ bannerId: '1' }))).toHaveLength(0);
  });

  // non-null 컬럼 속성은 명시적 null을 거절한다(서비스 trim()/Prisma 위반 500 방지)
  it.each(['placement', 'imageUrl', 'linkType', 'sortOrder', 'isActive'])(
    '%s: null 거절',
    async (field) => {
      const errors = await validate(build({ bannerId: '1', [field]: null }));
      expect(errors.map((e) => e.property)).toEqual([field]);
    },
  );

  // 지울 수 있는 속성은 null이 의도된 값이다
  it.each([
    'title',
    'linkUrl',
    'linkProductId',
    'linkStoreId',
    'linkCategoryId',
    'startsAt',
    'endsAt',
  ])('%s: null 허용', async (field) => {
    expect(
      await validate(build({ bannerId: '1', [field]: null })),
    ).toHaveLength(0);
  });

  it('placement·linkType 은 enum 밖 값을 거절한다', async () => {
    const errors = await validate(
      build({ bannerId: '1', placement: 'FOOTER', linkType: 'DEEP_LINK' }),
    );
    expect(errors.map((e) => e.property).sort()).toEqual([
      'linkType',
      'placement',
    ]);
  });
});
