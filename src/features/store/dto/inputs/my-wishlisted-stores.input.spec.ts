import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MyWishlistedStoresInput } from '@/features/store/dto/inputs/my-wishlisted-stores.input';

function build(plain: object): MyWishlistedStoresInput {
  return plainToInstance(MyWishlistedStoresInput, plain);
}

describe('MyWishlistedStoresInput', () => {
  it('빈 입력 통과 (모두 optional)', async () => {
    expect(await validate(build({}))).toHaveLength(0);
  });

  it('offset/limit 통과', async () => {
    expect(await validate(build({ offset: 0, limit: 20 }))).toHaveLength(0);
  });

  it('offset 음수 거절', async () => {
    const errors = await validate(build({ offset: -1 }));
    expect(errors[0].property).toBe('offset');
  });

  it('limit 하한(0)·상한(51) 거절', async () => {
    expect((await validate(build({ limit: 0 })))[0].property).toBe('limit');
    expect((await validate(build({ limit: 51 })))[0].property).toBe('limit');
  });

  it('정수가 아닌 limit 거절', async () => {
    const errors = await validate(build({ limit: 1.5 }));
    expect(errors[0].property).toBe('limit');
  });
});
