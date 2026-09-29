import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminCreateAdminInput } from '@/features/auth/dto/inputs/admin-create-admin.input';

function build(plain: object): AdminCreateAdminInput {
  return plainToInstance(AdminCreateAdminInput, plain);
}

const valid = { username: 'ops.admin_1', password: 'Strong!Pass1' };

describe('AdminCreateAdminInput', () => {
  it('유효 입력 통과(email·name 생략 가능)', async () => {
    expect(await validate(build(valid))).toHaveLength(0);
    expect(
      await validate(build({ ...valid, email: 'a@b.co', name: '운영자' })),
    ).toHaveLength(0);
  });

  it.each([
    ['길이 4 미만', 'abc'],
    ['길이 80 초과', 'a'.repeat(81)],
    ['대문자 포함', 'Admin1'],
    ['공백 포함', 'ad min'],
    ['허용 외 문자(@)', 'ad@min'],
    ['한글', '관리자계정'],
  ])('username %s 거절', async (_label, username) => {
    const errors = await validate(build({ ...valid, username }));
    expect(errors.map((e) => e.property)).toEqual(['username']);
  });

  it.each([
    ['숫자만', '12345678'],
    ['아이디와 같은 값', 'testadmin'],
    ['같은 문자 반복', 'aaaaaaaa'],
    ['특수문자 누락', 'NoSpecial1'],
    ['알파벳 누락', '12345678!!'],
    ['숫자 누락', 'NoDigits!!'],
  ])('초기 password는 조합 규칙 없이 허용: %s', async (_label, password) => {
    expect(await validate(build({ ...valid, password }))).toHaveLength(0);
  });

  it.each([
    ['7자', 'abcdefg'],
    ['65자', 'a'.repeat(65)],
    ['비문자열', 12345678],
  ])('password %s 거절', async (_label, password) => {
    const errors = await validate(build({ ...valid, password }));
    expect(errors.map((e) => e.property)).toEqual(['password']);
  });

  it('email 형식 오류 거절', async () => {
    const errors = await validate(build({ ...valid, email: 'not-an-email' }));
    expect(errors.map((e) => e.property)).toEqual(['email']);
  });

  it('name 길이 100 초과 거절', async () => {
    const errors = await validate(build({ ...valid, name: 'n'.repeat(101) }));
    expect(errors.map((e) => e.property)).toEqual(['name']);
  });
});
