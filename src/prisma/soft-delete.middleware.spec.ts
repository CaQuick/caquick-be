import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Prisma } from '@/generated/prisma/client';
import {
  applySoftDeleteArgs,
  SOFT_DELETE_MODEL_NAMES,
} from '@/prisma/soft-delete.middleware';

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

// 모델 추가 시 SOFT_DELETE_MODELS 갱신 누락(Region 사례, 이슈 #207)을 구조로 차단한다.
//
// Prisma 7의 새 제너레이터(prisma-client)는 런타임 DMMF를 노출하지 않으므로
// schema.prisma를 직접 읽어 대조한다. 스키마가 정본이라 대조 대상으로는 오히려 정확하다.
describe('SOFT_DELETE_MODELS 커버리지 (schema.prisma 대조)', () => {
  /** `model X { ... deleted_at ... }` 블록에서 deleted_at을 가진 모델 이름을 뽑는다 */
  function modelsWithDeletedAtIn(schema: string): string[] {
    const found: string[] = [];
    let current: string | null = null;

    for (const rawLine of schema.split('\n')) {
      const line = rawLine.trim();

      const start = /^model\s+([A-Za-z0-9_]+)\s*\{/.exec(line);
      if (start) {
        current = start[1];
        continue;
      }
      if (line === '}') {
        current = null;
        continue;
      }
      if (current && /^deleted_at\s+DateTime\?/.test(line)) {
        found.push(current);
        current = null; // 같은 모델을 두 번 담지 않는다
      }
    }

    return found;
  }

  const schema = readFileSync(
    resolve(__dirname, '..', '..', 'prisma', 'schema.prisma'),
    'utf8',
  );
  const modelsWithDeletedAt = modelsWithDeletedAtIn(schema);

  it('스키마를 실제로 파싱했다 (0건 통과 방지)', () => {
    expect(modelsWithDeletedAt.length).toBeGreaterThan(30);
    expect(modelsWithDeletedAt).toContain('Account');
  });

  it('파서가 심어 둔 모델을 잡는다 (반증 케이스)', () => {
    expect(
      modelsWithDeletedAtIn(
        'model Planted {\n  id BigInt @id\n  deleted_at DateTime? @db.DateTime(3)\n}',
      ),
    ).toEqual(['Planted']);

    // deleted_at이 없으면 잡히지 않아야 한다
    expect(
      modelsWithDeletedAtIn('model NoSoftDelete {\n  id BigInt @id\n}'),
    ).toEqual([]);

    // 필드명이 비슷하기만 한 경우도 잡히지 않아야 한다
    expect(
      modelsWithDeletedAtIn(
        'model Near {\n  id BigInt @id\n  deleted_at_by BigInt?\n}',
      ),
    ).toEqual([]);
  });

  it('deleted_at 컬럼을 가진 모든 모델이 목록에 등록되어 있다', () => {
    const missing = modelsWithDeletedAt.filter(
      (name) => !SOFT_DELETE_MODEL_NAMES.has(name as Prisma.ModelName),
    );
    expect(missing).toEqual([]);
  });

  it('목록에 deleted_at 없는 모델이 섞여 있지 않다', () => {
    const withDeletedAt = new Set<string>(modelsWithDeletedAt);
    const extras = [...SOFT_DELETE_MODEL_NAMES].filter(
      (name) => !withDeletedAt.has(name),
    );
    expect(extras).toEqual([]);
  });
});
