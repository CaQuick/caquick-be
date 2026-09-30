import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IsInitialPassword } from '@/common/validators/initial-password.validator';

class Sample {
  @IsInitialPassword()
  password!: string;
}

async function errorsOf(password: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(Sample, { password }));
  return errors.map((e) => e.property);
}

describe('IsInitialPassword', () => {
  it.each([
    ['숫자만', '12345678'],
    ['아이디와 같은 값', 'testadmin'],
    ['같은 문자 반복', 'aaaaaaaa'],
    ['64자 경계', 'a'.repeat(64)],
    ['앞뒤 공백 포함 원문 8자', ' abcdef '],
  ])('허용: %s', async (_label, value) => {
    expect(await errorsOf(value)).toEqual([]);
  });

  it.each([
    ['7자', 'abcdefg'],
    ['65자', 'a'.repeat(65)],
    ['숫자 타입', 12345678],
    ['null', null],
    ['누락', undefined],
    ['공백 8자', ' '.repeat(8)],
    ['탭·공백만 64자', ' \t'.repeat(32)],
  ])('거절: %s', async (_label, value) => {
    expect(await errorsOf(value)).toEqual(['password']);
  });
});
