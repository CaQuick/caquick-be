import { applySoftDeleteArgs } from './soft-delete.middleware';

describe('soft delete extension', () => {
  it('findFirst에 deleted_at 필터를 자동으로 추가해야 한다', () => {
    const params = {
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
    const params = {
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
    const params = {
      model: 'Account',
      operation: 'findUnique',
      args: {
        where: { id: BigInt(1) },
      },
    };

    const result = applySoftDeleteArgs(params);

    expect(result).toEqual(params.args);
  });
});
