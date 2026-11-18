import {
  retryOnceOnUniqueConflict,
  uniqueConstraintName,
} from '@/common/utils/prisma-error';
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

describe('retryOnceOnUniqueConflict', () => {
  it('P2002면 한 번 다시 돌리고 그 결과를 돌려준다', async () => {
    const run = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(p2002({}))
      .mockResolvedValueOnce('ok');
    await expect(retryOnceOnUniqueConflict(run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('두 번째도 P2002면 그대로 던진다(무한 재시도 없음)', async () => {
    const run = jest.fn<Promise<string>, []>().mockRejectedValue(p2002({}));
    await expect(retryOnceOnUniqueConflict(run)).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      '다른 Prisma 오류',
      new Prisma.PrismaClientKnownRequestError('x', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    ],
    ['일반 오류', new Error('boom')],
  ])('%s는 재시도하지 않는다', async (_label, error) => {
    const run = jest.fn<Promise<string>, []>().mockRejectedValue(error);
    await expect(retryOnceOnUniqueConflict(run)).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
