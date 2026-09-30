import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminResetAdminPasswordInput } from '@/features/auth/dto/inputs/admin-reset-admin-password.input';

function build(plain: object): AdminResetAdminPasswordInput {
  return plainToInstance(AdminResetAdminPasswordInput, plain);
}

describe('AdminResetAdminPasswordInput', () => {
  it.each([
    ['숫자만', '12345678'],
    ['아이디와 같은 값', 'testadmin'],
    ['같은 문자 반복', 'aaaaaaaa'],
    ['특수문자 누락', 'weakpass1'],
  ])(
    '새 초기 비밀번호는 조합 규칙 없이 허용: %s',
    async (_label, newPassword) => {
      expect(
        await validate(build({ accountId: '1', newPassword })),
      ).toHaveLength(0);
    },
  );

  it.each([
    ['7자', 'abcdefg'],
    ['65자', 'a'.repeat(65)],
    ['공백만', ' '.repeat(8)],
    ['비문자열', 12345678],
  ])('newPassword %s 거절', async (_label, newPassword) => {
    const errors = await validate(build({ accountId: '1', newPassword }));
    expect(errors.map((e) => e.property)).toEqual(['newPassword']);
  });
});
