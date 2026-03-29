import { Prisma } from '@prisma/client';

import { applySoftDeleteArgs } from '@/prisma/soft-delete.middleware';

type SoftDeleteInput = {
  model?: Prisma.ModelName;
  operation: Prisma.PrismaAction;
  args?: unknown;
};

describe('soft delete extension', () => {
  it('findFirst에 deleted_at 필터를 자동으로 추가해야 한다', () => {
    const params: SoftDeleteInput = {
      model: 'Account',
      operation: 'findFirst',
      args: {
        where: { email: 'test@example.com' },
      },
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual({
      where: { email: 'test@example.com', deleted_at: null },
    });
  });

  it('deleted_at 조건이 있으면 필터를 우회해야 한다', () => {
    const params: SoftDeleteInput = {
      model: 'Account',
      operation: 'findFirst',
      args: {
        where: { id: BigInt(1), deleted_at: undefined },
      },
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual({
      where: { id: BigInt(1), deleted_at: undefined },
    });
  });

  it('findUnique에는 필터를 추가하지 않아야 한다', () => {
    const params: SoftDeleteInput = {
      model: 'Account',
      operation: 'findUnique',
      args: {
        where: { id: BigInt(1) },
      },
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual(params.args);
  });

  it('findMany에 deleted_at 필터를 자동으로 추가해야 한다', () => {
    const params: SoftDeleteInput = {
      model: 'Account',
      operation: 'findMany',
      args: {
        where: { email: 'test@example.com' },
      },
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual({
      where: { email: 'test@example.com', deleted_at: null },
    });
  });

  it('count에 deleted_at 필터를 자동으로 추가해야 한다', () => {
    const params: SoftDeleteInput = {
      model: 'Account',
      operation: 'count',
      args: {
        where: { email: 'test@example.com' },
      },
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual({
      where: { email: 'test@example.com', deleted_at: null },
    });
  });

  it('create 작업에는 필터를 추가하지 않아야 한다', () => {
    const params: SoftDeleteInput = {
      model: 'Account',
      operation: 'create',
      args: {
        data: { email: 'test@example.com' },
      },
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual(params.args);
  });

  it('update 작업에는 필터를 추가하지 않아야 한다', () => {
    const params: SoftDeleteInput = {
      model: 'Account',
      operation: 'update',
      args: {
        where: { id: BigInt(1) },
        data: { email: 'new@example.com' },
      },
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual(params.args);
  });

  it('SOFT_DELETE_MODELS에 없는 모델이면 필터를 추가하지 않아야 한다', () => {
    const params: SoftDeleteInput = {
      model: 'NonExistentModel' as Prisma.ModelName,
      operation: 'findFirst',
      args: {
        where: { id: BigInt(1) },
      },
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual(params.args);
  });

  it('model이 undefined이면 필터를 추가하지 않아야 한다', () => {
    const params: SoftDeleteInput = {
      model: undefined,
      operation: 'findFirst',
      args: {
        where: { id: BigInt(1) },
      },
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual(params.args);
  });

  it('args가 undefined이면 정상적으로 처리해야 한다', () => {
    const params: SoftDeleteInput = {
      model: 'Account',
      operation: 'findFirst',
      args: undefined,
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual({
      where: { deleted_at: null },
    });
  });

  it('where에 deleted_at: null이 이미 있으면 덮어쓰지 않아야 한다', () => {
    const params: SoftDeleteInput = {
      model: 'Account',
      operation: 'findFirst',
      args: {
        where: { id: BigInt(1), deleted_at: null },
      },
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual({
      where: { id: BigInt(1), deleted_at: null },
    });
  });

  it('args의 다른 속성(include, select 등)을 보존해야 한다', () => {
    const params: SoftDeleteInput = {
      model: 'Account',
      operation: 'findFirst',
      args: {
        where: { email: 'test@example.com' },
        include: { UserProfile: true },
        select: { id: true, email: true },
      },
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual({
      where: { email: 'test@example.com', deleted_at: null },
      include: { UserProfile: true },
      select: { id: true, email: true },
    });
  });
});
