import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IsStrongPassword } from '@/common/validators/strong-password.validator';

class Sample {
  @IsStrongPassword()
  password!: string;
}

function build(plain: object): Sample {
  return plainToInstance(Sample, plain);
}

describe('IsStrongPassword', () => {
  it.each([
    ['8자 + 4종', 'Aa1!aaaa'],
    ['긴 비밀번호', 'My!Sup3rL0ngPassword#WithSymbols'],
    [
      '64자 경계',
      'A'.repeat(15) + 'a'.repeat(15) + '0'.repeat(15) + '!'.repeat(19),
    ], // 64
  ])('허용: %s', async (_label, value) => {
    const dto = build({ password: value });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['7자', 'Aa1!aaa'],
    ['65자', 'Aa1!' + 'b'.repeat(61)],
    ['소문자 누락', 'AAAA1111!!!!'],
    ['대문자 누락', 'aaaa1111!!!!'],
    ['숫자 누락', 'AAaa!!@@##'],
    ['특수문자 누락', 'AAaa1122334'],
  ])('거절: %s', async (_label, value) => {
    const dto = build({ password: value });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('password');
  });

  it('길이는 원문 기준: 앞뒤 공백을 포함해 65자면 거절(로그인 DTO의 원문 길이 검사와 일치)', async () => {
    const core = 'Aa1!' + 'b'.repeat(60); // 64
    expect(await validate(build({ password: core }))).toHaveLength(0);
    expect(await validate(build({ password: core + ' ' }))).toHaveLength(1);
  });

  it('원문 길이가 8 이상이면 앞뒤 공백이 있어도 허용한다(저장·로그인 모두 원문)', async () => {
    const dto = build({ password: ' Aa1!aaa ' }); // 9 chars raw
    expect(await validate(dto)).toHaveLength(0);
  });

  it('문자열이 아닌 값은 거절한다', async () => {
    const dto = build({ password: 12345678 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });
});
