import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IsInitialPasswordConstraint } from '@/common/validators/initial-password.validator';
import { CredentialLoginInput } from '@/features/auth/dto/inputs/credential-login.input';

function build(plain: object): CredentialLoginInput {
  return plainToInstance(CredentialLoginInput, plain);
}

describe('CredentialLoginInput', () => {
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

  it('username 길이 80 초과 거절', async () => {
    const dto = build({ username: 'a'.repeat(81), password: 'Aa1!aaaa' });
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

  // 관리자가 지정한 초기 비밀번호는 그대로 로그인할 수 있어야 한다
  it.each([
    ['7자', 'abcdefg'],
    ['8자', 'abcdefgh'],
    ['64자', 'a'.repeat(64)],
    ['65자', 'a'.repeat(65)],
    ['앞뒤 공백', ' abcdef '],
    ['이모지 8개(UTF-16 16단위)', '😀'.repeat(8)],
    ['이모지 40개(UTF-16 80단위)', '😀'.repeat(40)],
    ['이모지 65개', '😀'.repeat(65)],
    ['비문자열', 12345678],
  ])(
    '초기 비밀번호 검증기와 password 판정이 같다: %s',
    async (_label, password) => {
      const loginOk =
        (await validate(build({ username: 'seller01', password }))).length ===
        0;
      expect(new IsInitialPasswordConstraint().validate(password)).toBe(
        loginOk,
      );
    },
  );
});
