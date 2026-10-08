import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminCreateSellerInput } from '@/features/store/dto/inputs/admin-create-seller.input';

function build(plain: object): AdminCreateSellerInput {
  return plainToInstance(AdminCreateSellerInput, plain);
}

const validStore = {
  storeName: '매장',
  storePhone: '02-0000-0001',
  addressFull: '서울 어딘가',
};
const valid = {
  username: 'shop.owner',
  password: 'Strong!Pass1',
  businessName: '상호',
  businessPhone: '02-0000-0000',
  store: validStore,
};

describe('AdminCreateSellerInput', () => {
  it('유효 입력 통과(선택 필드 생략)', async () => {
    expect(await validate(build(valid))).toHaveLength(0);
  });

  it('username에 영문 대문자를 허용한다', async () => {
    expect(
      await validate(build({ ...valid, username: 'Shop.Owner' })),
    ).toHaveLength(0);
  });

  it('store 누락 거절', async () => {
    const { store: _store, ...withoutStore } = valid;
    const errors = await validate(build(withoutStore));
    expect(errors.map((e) => e.property)).toEqual(['store']);
  });

  it.each(['storeName', 'storePhone', 'addressFull'])(
    'store.%s 누락은 중첩 검증으로 거절',
    async (field) => {
      const store = { ...validStore, [field]: undefined };
      const errors = await validate(build({ ...valid, store }));
      expect(errors.map((e) => e.property)).toEqual(['store']);
      expect(errors[0].children?.map((c) => c.property)).toEqual([field]);
    },
  );

  it('store.mapProvider enum 밖 값 거절', async () => {
    const errors = await validate(
      build({ ...valid, store: { ...validStore, mapProvider: 'GOOGLE' } }),
    );
    expect(errors[0].children?.map((c) => c.property)).toEqual(['mapProvider']);
  });

  it.each([
    ['숫자만', '12345678'],
    ['아이디와 같은 값', 'testadmin'],
    ['같은 문자 반복', 'aaaaaaaa'],
    ['특수문자 누락', 'weakpass1'],
  ])('초기 password는 조합 규칙 없이 허용: %s', async (_label, password) => {
    expect(await validate(build({ ...valid, password }))).toHaveLength(0);
  });

  it.each([
    ['7자', 'abcdefg'],
    ['65자', 'a'.repeat(65)],
    ['비문자열', 12345678],
  ])('password %s 거절', async (_label, password) => {
    const errors = await validate(build({ ...valid, password }));
    expect(errors.map((e) => e.property)).toEqual(['password']);
  });

  it.each([
    ['username 허용 외 문자', { username: 'shop@owner' }],
    ['email 형식', { email: 'nope' }],
    ['businessName 누락', { businessName: undefined }],
  ])('%s 거절', async (_label, overrides) => {
    const errors = await validate(build({ ...valid, ...overrides }));
    expect(errors).toHaveLength(1);
  });
});
