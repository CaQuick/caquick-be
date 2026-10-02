import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Kind, parse } from 'graphql';

import { AUDIT_TARGET_TYPES } from '@/features/dashboard/constants/dashboard.constants';
import { AuditTargetType } from '@/generated/prisma/client';

/**
 * 감사 대상 종류는 세 곳에 따로 적혀 있고 tsc가 서로를 묶지 못한다.
 * - SDL enum이 빠지면 그 행이 든 adminAuditLogs 페이지 전체가 직렬화 오류로 실패한다.
 * - 대시보드 목록이 빠지면 그 값으로 감사 로그를 거를 수 없다(@IsIn 거절).
 */
function enumDrift(
  expected: readonly string[],
  actual: readonly string[],
): { missing: string[]; extra: string[] } {
  return {
    missing: expected.filter((v) => !actual.includes(v)),
    extra: actual.filter((v) => !expected.includes(v)),
  };
}

function sdlEnumValues(file: string, enumName: string): string[] {
  const doc = parse(readFileSync(join(process.cwd(), file), 'utf8'));
  for (const def of doc.definitions) {
    if (def.kind === Kind.ENUM_TYPE_DEFINITION && def.name.value === enumName) {
      return (def.values ?? []).map((v) => v.name.value);
    }
  }
  throw new Error(`${file}에 enum ${enumName}이 없습니다`);
}

const PRISMA_VALUES = Object.values(AuditTargetType);
const SDL_VALUES = sdlEnumValues(
  'src/features/audit-log/audit-log.types.graphql',
  'AuditTargetType',
);

describe('AuditTargetType 정합(Prisma · SDL · 대시보드 필터 목록)', () => {
  describe('enumDrift 반증', () => {
    it.each([
      ['같은 집합(순서 무관)', ['A', 'B'], ['B', 'A'], [], []],
      ['한쪽에 빠짐', ['A', 'B'], ['A'], ['B'], []],
      ['한쪽에 남음', ['A'], ['A', 'B'], [], ['B']],
      ['빠짐과 남음 동시', ['A', 'B'], ['A', 'C'], ['B'], ['C']],
    ])('%s', (_label, expected, actual, missing, extra) => {
      expect(enumDrift(expected, actual)).toEqual({ missing, extra });
    });

    it('SDL 파일에 enum이 없으면 실패한다', () => {
      expect(() =>
        sdlEnumValues(
          'src/features/audit-log/audit-log.types.graphql',
          'NoSuchEnum',
        ),
      ).toThrow('NoSuchEnum');
    });
  });

  it('대조 대상이 비어 있지 않다', () => {
    expect(PRISMA_VALUES.length).toBeGreaterThan(0);
    expect(SDL_VALUES.length).toBeGreaterThan(0);
  });

  it('SDL enum이 Prisma enum과 같다', () => {
    expect(enumDrift(PRISMA_VALUES, SDL_VALUES)).toEqual({
      missing: [],
      extra: [],
    });
  });

  it('대시보드 필터 목록(AUDIT_TARGET_TYPES)이 Prisma enum과 같다', () => {
    expect(enumDrift(PRISMA_VALUES, AUDIT_TARGET_TYPES)).toEqual({
      missing: [],
      extra: [],
    });
  });
});
