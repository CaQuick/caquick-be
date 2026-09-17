import { uniqueConstraintName } from '@/common/utils/prisma-error';
import { Prisma } from '@/generated/prisma/client';

function p2002(
  meta: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: 'test',
    meta,
  });
}

describe('uniqueConstraintName', () => {
  it.each([
    [
      'meta.target 문자열(6.x 엔진)',
      { target: 'uk_order_account_idempotency' },
      'uk_order_account_idempotency',
    ],
    [
      'meta.target 배열',
      { target: ['account_id', 'idempotency_key'] },
      'account_id,idempotency_key',
    ],
    [
      'driverAdapterError.constraint.index(7.x 어댑터)',
      {
        driverAdapterError: {
          cause: { constraint: { index: 'uk_order_account_idempotency' } },
        },
      },
      'uk_order_account_idempotency',
    ],
    [
      'driverAdapterError.constraint.fields',
      { driverAdapterError: { cause: { constraint: { fields: ['a', 'b'] } } } },
      'a,b',
    ],
    ['제약 정보 없음', {}, null],
  ])('%s', (_label, meta, expected) => {
    expect(uniqueConstraintName(p2002(meta))).toBe(expected);
  });

  it('P2002가 아니면 null', () => {
    const err = new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2025',
      clientVersion: 'test',
      meta: { target: 'whatever' },
    });
    expect(uniqueConstraintName(err)).toBeNull();
  });
});
