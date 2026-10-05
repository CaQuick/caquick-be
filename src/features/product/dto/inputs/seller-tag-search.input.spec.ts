import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerTagSearchInput } from '@/features/product/dto/inputs/seller-tag-search.input';

function build(plain: object): SellerTagSearchInput {
  return plainToInstance(SellerTagSearchInput, plain);
}

describe('SellerTagSearchInput', () => {
  it('keyword만 주면 통과(limit 기본값은 SDL이 채운다)', async () => {
    expect(await validate(build({ keyword: '생일' }))).toHaveLength(0);
    expect(
      await validate(build({ keyword: '생일', limit: null })),
    ).toHaveLength(0);
  });

  it('keyword가 문자열이 아니면 거절', async () => {
    const errors = await validate(build({ keyword: 1 }));
    expect(errors[0].property).toBe('keyword');
  });

  it('빈 문자열·공백 keyword는 DTO를 통과한다(서비스가 빈 배열로 응답)', async () => {
    expect(await validate(build({ keyword: '' }))).toHaveLength(0);
    expect(await validate(build({ keyword: '  ' }))).toHaveLength(0);
  });

  it.each([0, 21, 1.5])('limit %p 거절', async (limit) => {
    const errors = await validate(build({ keyword: 'a', limit }));
    expect(errors[0].property).toBe('limit');
  });

  it.each([1, 20])('limit %p 통과', async (limit) => {
    expect(await validate(build({ keyword: 'a', limit }))).toHaveLength(0);
  });
});
