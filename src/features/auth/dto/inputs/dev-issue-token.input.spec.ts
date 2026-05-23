import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DevIssueTokenInput } from '@/features/auth/dto/inputs/dev-issue-token.input';

function build(plain: object): DevIssueTokenInput {
  return plainToInstance(DevIssueTokenInput, plain);
}

describe('DevIssueTokenInput', () => {
  it.each([
    ['1', '1'],
    ['123', '123'],
    ['0', '0'],
    ['999999999999999999', '999999999999999999'], // BigInt 범위
  ])('허용: %s', async (_label, value) => {
    const dto = build({ accountId: value });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['빈 문자열', ''],
    ['음수', '-1'],
    ['소수', '1.5'],
    ['알파벳 혼재', 'abc'],
    ['공백 포함', ' 1'],
    ['끝 공백', '1 '],
  ])('거절: %s ("%s")', async (_label, value) => {
    const dto = build({ accountId: value });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('accountId');
  });

  it('accountId 누락 거절', async () => {
    const dto = build({});
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('accountId');
  });

  it('숫자 타입은 거절한다', async () => {
    const dto = build({ accountId: 123 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });
});
