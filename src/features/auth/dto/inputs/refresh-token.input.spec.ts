import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { generateRandomToken } from '@/common/utils/crypto';
import { RefreshTokenInput } from '@/features/auth/dto/inputs/refresh-token.input';

function build(plain: object): RefreshTokenInput {
  return plainToInstance(RefreshTokenInput, plain);
}

describe('RefreshTokenInput', () => {
  it.each([
    ['발급 형식(hex 64)', generateRandomToken(32)],
    ['0·f 경계', '0'.repeat(32) + 'f'.repeat(32)],
  ])('허용: %s', async (_label, value) => {
    expect(await validate(build({ refreshToken: value }))).toHaveLength(0);
  });

  it.each([
    ['누락(쿠키 모드)', {}],
    ['undefined', { refreshToken: undefined }],
    ['null', { refreshToken: null }],
  ])('허용: %s', async (_label, plain) => {
    expect(await validate(build(plain))).toHaveLength(0);
  });

  it.each([
    ['빈 문자열', ''],
    ['63자', 'a'.repeat(63)],
    ['65자', 'a'.repeat(65)],
    ['대문자 hex', 'A'.repeat(64)],
    ['hex 아닌 문자', 'g'.repeat(64)],
    ['앞 공백', ' ' + 'a'.repeat(63)],
    ['숫자 타입', 1],
    ['객체', { token: 'a'.repeat(64) }],
  ])('거절: %s', async (_label, value) => {
    const errors = await validate(build({ refreshToken: value }));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('refreshToken');
  });
});
