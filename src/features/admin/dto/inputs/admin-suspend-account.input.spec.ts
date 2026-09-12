import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminSuspendAccountInput } from '@/features/admin/dto/inputs/admin-suspend-account.input';

function build(plain: object): AdminSuspendAccountInput {
  return plainToInstance(AdminSuspendAccountInput, plain);
}

describe('AdminSuspendAccountInput', () => {
  it('유효 입력 통과', async () => {
    expect(
      await validate(build({ accountId: '1', reason: '사유' })),
    ).toHaveLength(0);
  });

  it('reason 누락·null 거절', async () => {
    expect(
      (await validate(build({ accountId: '1' }))).map((e) => e.property),
    ).toEqual(['reason']);
    expect(
      (await validate(build({ accountId: '1', reason: null }))).map(
        (e) => e.property,
      ),
    ).toEqual(['reason']);
  });

  it('reason 500자 초과 거절', async () => {
    const errors = await validate(
      build({ accountId: '1', reason: 'r'.repeat(501) }),
    );
    expect(errors.map((e) => e.property)).toEqual(['reason']);
  });
});
