import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MyWishlistInput } from '@/features/user/dto/inputs/my-wishlist.input';

function build(plain: object): MyWishlistInput {
  return plainToInstance(MyWishlistInput, plain);
}

describe('MyWishlistInput', () => {
  it('빈 입력 통과 (모두 optional)', async () => {
    expect(await validate(build({}))).toHaveLength(0);
  });

  it('storeId 문자열 + offset/limit 통과', async () => {
    const errors = await validate(
      build({ storeId: '1', offset: 0, limit: 20 }),
    );
    expect(errors).toHaveLength(0);
  });

  it('storeId 가 문자열이 아니면 거절', async () => {
    const errors = await validate(build({ storeId: 1 }));
    expect(errors[0].property).toBe('storeId');
  });

  it('offset 음수 거절 (UserPaginationInput 상속)', async () => {
    const errors = await validate(build({ offset: -1 }));
    expect(errors[0].property).toBe('offset');
  });
});
