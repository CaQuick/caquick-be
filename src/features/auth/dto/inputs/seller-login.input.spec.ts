import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerLoginInput } from '@/features/auth/dto/inputs/seller-login.input';

function build(plain: object): SellerLoginInput {
  return plainToInstance(SellerLoginInput, plain);
}

describe('SellerLoginInput', () => {
  it('유효 입력 통과', async () => {
    const dto = build({ username: 'seller01', password: 'Aa1!aaaa' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('username 길이 4 미만 거절', async () => {
    const dto = build({ username: 'abc', password: 'Aa1!aaaa' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('username');
  });

  it('username 길이 50 초과 거절', async () => {
    const dto = build({ username: 'a'.repeat(51), password: 'Aa1!aaaa' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('username');
  });

  it('password 길이 8 미만 거절', async () => {
    const dto = build({ username: 'seller01', password: 'short' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('password');
  });

  it('password 길이 64 초과 거절', async () => {
    const dto = build({ username: 'seller01', password: 'a'.repeat(65) });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('password');
  });

  it('username · password 동시 위반 시 두 에러 보고', async () => {
    const dto = build({ username: 'a', password: 'b' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(2);
    const props = errors.map((e) => e.property).sort();
    expect(props).toEqual(['password', 'username']);
  });

  it('필드 누락 거절', async () => {
    const dto = build({});
    const errors = await validate(dto);
    expect(errors).toHaveLength(2);
  });
});
