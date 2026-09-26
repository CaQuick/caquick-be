import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminUpdateStoreBasicInfoInput } from '@/features/store/dto/inputs/admin-update-store-basic-info.input';

function build(plain: object): AdminUpdateStoreBasicInfoInput {
  return plainToInstance(AdminUpdateStoreBasicInfoInput, plain);
}

describe('AdminUpdateStoreBasicInfoInput', () => {
  it('storeId만 있는 부분 수정 통과', async () => {
    expect(await validate(build({ storeId: '1' }))).toHaveLength(0);
  });

  // non-null 컬럼은 명시적 null 거절
  it.each(['storeName', 'storePhone', 'addressFull', 'mapProvider'])(
    '%s: null 거절',
    async (field) => {
      const errors = await validate(build({ storeId: '1', [field]: null }));
      expect(errors.map((e) => e.property)).toEqual([field]);
    },
  );

  // 지울 수 있는 속성은 null 허용
  it.each([
    'addressCity',
    'addressDistrict',
    'addressNeighborhood',
    'regionId',
    'latitude',
    'longitude',
    'websiteUrl',
    'businessHoursText',
    'profileImageUrl',
    'greetingMessage',
  ])('%s: null 허용', async (field) => {
    expect(await validate(build({ storeId: '1', [field]: null }))).toHaveLength(
      0,
    );
  });

  it('mapProvider enum 밖 값 거절', async () => {
    const errors = await validate(
      build({ storeId: '1', mapProvider: 'GOOGLE' }),
    );
    expect(errors.map((e) => e.property)).toEqual(['mapProvider']);
  });
});
