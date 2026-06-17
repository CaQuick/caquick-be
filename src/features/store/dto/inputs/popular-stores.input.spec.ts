import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PopularStoresInput } from '@/features/store/dto/inputs/popular-stores.input';

function build(plain: object): PopularStoresInput {
  return plainToInstance(PopularStoresInput, plain);
}

describe('PopularStoresInput', () => {
  it('빈 입력 통과 (모두 optional)', async () => {
    expect(await validate(build({}))).toHaveLength(0);
  });

  it('regionIds 문자열 배열 + offset/limit 통과', async () => {
    const errors = await validate(
      build({ regionIds: ['1', '2'], offset: 0, limit: 20 }),
    );
    expect(errors).toHaveLength(0);
  });

  it('regionIds 가 배열이 아니면 거절', async () => {
    const errors = await validate(build({ regionIds: '1' }));
    expect(errors[0].property).toBe('regionIds');
  });

  it('regionIds 원소가 문자열이 아니면 거절', async () => {
    const errors = await validate(build({ regionIds: [1, 2] }));
    expect(errors[0].property).toBe('regionIds');
  });

  it('offset 음수 거절', async () => {
    const errors = await validate(build({ offset: -1 }));
    expect(errors[0].property).toBe('offset');
  });

  it('limit 하한(0)·상한(51) 거절', async () => {
    expect((await validate(build({ limit: 0 })))[0].property).toBe('limit');
    expect((await validate(build({ limit: 51 })))[0].property).toBe('limit');
  });
});
