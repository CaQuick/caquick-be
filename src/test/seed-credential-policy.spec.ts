import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { assertSeedCredential } from '../../prisma/seed/credential-policy';

import { AdminCreateAdminInput } from '@/features/auth/dto/inputs/admin-create-admin.input';

const PASSWORD = 'Strong!Pass1';

function seedAccepts(username: string): boolean {
  try {
    assertSeedCredential({ username, password: PASSWORD });
    return true;
  } catch {
    return false;
  }
}

async function dtoAccepts(username: string): Promise<boolean> {
  const input = plainToInstance(AdminCreateAdminInput, {
    username,
    password: PASSWORD,
  });
  return (await validate(input)).length === 0;
}

// 시드가 만든 계정이 관리자 생성 경로와 같은 username 정책을 따르는지 — 두 판정이 어긋나면 안 된다
describe('시드 자격증명 username 정책', () => {
  it.each([
    ['소문자', 'ops.admin', true],
    ['대문자 혼용', 'Ops.Admin_1', true],
    ['전부 대문자', 'OPS-ADMIN', true],
    ['4자', 'abcd', true],
    ['80자', 'a'.repeat(80), true],
    ['3자', 'abc', false],
    ['81자', 'a'.repeat(81), false],
    ['공백', 'ops admin', false],
    ['허용 외 문자(@)', 'ops@admin', false],
    ['한글', '관리자계정', false],
  ])('%s: 생성 DTO와 같은 판정(%s → %s)', async (_label, username, ok) => {
    expect(seedAccepts(username)).toBe(ok);
    expect(await dtoAccepts(username)).toBe(ok);
  });

  it('위반 메시지에 username 값을 싣지 않는다', () => {
    expect(() =>
      assertSeedCredential({ username: 'bad@name', password: PASSWORD }),
    ).toThrow(/^시드 username 정책 위반: 4~80자/);
    expect(() =>
      assertSeedCredential({ username: 'bad@name', password: PASSWORD }),
    ).not.toThrow(/bad@name/);
  });

  it('password 정책 위반은 별도 메시지로 거절한다', () => {
    expect(() =>
      assertSeedCredential({ username: 'ops.admin', password: 'weak' }),
    ).toThrow(/^시드 password 정책 위반/);
  });
});
