import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Change } from './pre-push-test-plan';
import {
  isGateSpec,
  parseNameStatus,
  planTests,
  pushedRefMismatch,
  RELATED_LIMIT,
  resolveBase,
} from './pre-push-test-plan';

const M = (path: string): Change => ({ path, status: 'M' });
const D = (path: string): Change => ({ path, status: 'D' });
const SERVICE = 'src/features/order/services/order.service.ts';

describe('planTests', () => {
  // 반증 — 서비스 1개와 섞여도 이 파일들이 끼면 전체로 간다. 이유까지 보는 건
  // 개별 규칙이 빠져도 "분류되지 않은 파일" 폴백이 full을 대신 내서 가려지지 않게.
  const DELETED = '삭제·이름 변경';
  const UNKNOWN = '분류되지 않은';
  it.each([
    [M('src/features/order/order.graphql'), 'SDL'],
    [D('src/features/order/order.graphql'), 'SDL'],
    [M('prisma/schema.prisma'), 'prisma'],
    [M('prisma/migrations/20260930_x/migration.sql'), 'prisma'],
    [M('prisma/seed.ts'), 'prisma'],
    [M('prisma.config.ts'), 'prisma'],
    [M('src/test/factories/order.factory.ts'), '테스트 인프라'],
    [M('src/test/jest.global-setup.ts'), '테스트 인프라'],
    [M('src/test/model-ownership.spec.ts'), '테스트 인프라'],
    [M('test/jest-e2e.json'), '테스트 인프라'],
    [M('jest.config.js'), 'jest 설정'],
    [M('package.json'), 'package.json'],
    [M('yarn.lock'), '의존성'],
    [M('.yarnrc.yml'), '의존성'],
    [M('.yarn/patches/x.patch'), '의존성'],
    [M('tsconfig.json'), '컴파일 설정'],
    [M('tsconfig.build.json'), '컴파일 설정'],
    [M('src/config/redis.config.ts'), '전역 배선'],
    [M('src/global/alerting/alert.service.ts'), '전역 배선'],
    [M('src/app.module.ts'), '전역 배선'],
    [M('src/main.ts'), '전역 배선'],
    [D('src/features/order/helpers/price.helper.ts'), DELETED],
    [D('src/features/order/services/order.service.spec.ts'), DELETED],
    [M('src/features/order/fixtures/sample.json'), UNKNOWN],
    [M('.gitignore'), UNKNOWN], // build-config.spec이 읽는다
    [M('nest-cli.json'), UNKNOWN], // build-config.spec이 읽는다
    [M('codegen.yml'), UNKNOWN],
  ])('반증: %j → full(%s)', (change, reason) => {
    expect(planTests([M(SERVICE), change])).toEqual({
      mode: 'full',
      reasons: [expect.stringMatching(`^${change.path}: .*${reason}`)],
    });
  });

  it.each([
    ['src 서비스', [M(SERVICE)], [SERVICE]],
    [
      '새 파일',
      [{ path: 'src/features/order/helpers/new.helper.ts', status: 'A' }],
      ['src/features/order/helpers/new.helper.ts'],
    ],
    [
      'spec 자체',
      [M('src/features/order/services/order.service.spec.ts')],
      ['src/features/order/services/order.service.spec.ts'],
    ],
    [
      '스냅샷은 그 spec으로',
      [M('src/features/auth/controllers/__snapshots__/a.spec.ts.snap')],
      ['src/features/auth/controllers/a.spec.ts'],
    ],
    [
      'src/prisma(import 그래프로 잡힘)',
      [M('src/prisma/prisma.service.ts')],
      ['src/prisma/prisma.service.ts'],
    ],
    [
      '문서와 섞여도 related',
      [M(SERVICE), M('README.md'), M('docs/guide/a.md')],
      [SERVICE],
    ],
  ])('%s → related', (_label, changes, files) => {
    expect(planTests(changes)).toEqual({ mode: 'related', files });
  });

  it.each([
    ['변경 없음', []],
    ['README', [M('README.md')]],
    ['가이드', [M('docs/guide/architecture-conventions.md')]],
    ['워크플로', [M('.github/workflows/pr-check.yml')]],
    [
      '인프라',
      [
        M('infra/runbook.md'),
        M('infra/compose/prod.yml'),
        M('terraform/main.tf'),
      ],
    ],
    [
      '도커',
      [M('Dockerfile'), M('docker-compose.yml'), M('docker/mysql/init.sql')],
    ],
    [
      'scripts(test:scripts가 전부 돌림)',
      [M('scripts/outbox-requeue.ts'), D('scripts/old.ts')],
    ],
    ['scripts jest 설정', [M('jest.scripts.config.js')]],
    [
      '정적 검사 설정',
      [M('eslint.config.mjs'), M('.dependency-cruiser.cjs'), M('knip.json')],
    ],
    ['훅', [M('.husky/pre-push')]],
  ])('%s → none', (_label, changes) => {
    expect(planTests(changes)).toEqual({ mode: 'none' });
  });

  it('게이트 spec은 related에만 붙고 중복은 합친다', () => {
    const gate = 'src/test/read-boundary.spec.ts';
    const spec = 'src/features/order/services/order.service.spec.ts';
    expect(planTests([M(SERVICE), M(spec)], [gate, spec])).toEqual({
      mode: 'related',
      files: [SERVICE, spec, gate],
    });
    expect(planTests([M('README.md')], [gate])).toEqual({ mode: 'none' });
  });

  it('src 변경이 임계를 넘으면 full, 임계 이하는 related', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => M(`src/features/f/f${i}.ts`));
    expect(planTests(many(RELATED_LIMIT)).mode).toBe('related');
    expect(planTests(many(RELATED_LIMIT + 1))).toEqual({
      mode: 'full',
      reasons: [`src 변경 ${RELATED_LIMIT + 1}개 > ${RELATED_LIMIT}개`],
    });
    // 문서는 세지 않는다
    const docs = Array.from({ length: 100 }, (_, i) =>
      M(`docs/guide/d${i}.md`),
    );
    expect(planTests([...many(1), ...docs]).mode).toBe('related');
  });
});

describe('parseNameStatus', () => {
  it('이름 변경은 옛 경로 삭제 + 새 경로 추가, 복사는 새 경로 추가로 푼다', () => {
    const output = [
      'M\tsrc/a.ts',
      'A\tsrc/b.ts',
      'D\tsrc/c.ts',
      'R100\tsrc/old.ts\tsrc/new.ts',
      'C75\tsrc/base.ts\tsrc/copy.ts',
      'T\tsrc/link.ts',
      '',
    ].join('\n');
    expect(parseNameStatus(output)).toEqual([
      { path: 'src/a.ts', status: 'M' },
      { path: 'src/b.ts', status: 'A' },
      { path: 'src/c.ts', status: 'D' },
      { path: 'src/old.ts', status: 'D' },
      { path: 'src/new.ts', status: 'A' },
      { path: 'src/copy.ts', status: 'A' },
      { path: 'src/link.ts', status: 'T' },
    ]);
  });

  it('반증: ts 이름 변경은 옛 경로 때문에 full', () => {
    const plan = planTests(
      parseNameStatus('R090\tsrc/features/a/x.ts\tsrc/features/a/y.ts'),
    );
    expect(plan.mode).toBe('full');
  });
});

describe('resolveBase', () => {
  const runner = (answers: Record<string, string | Error>) =>
    jest.fn((args: string[]) => {
      const answer = answers[args[2]];
      if (answer === undefined || answer instanceof Error)
        throw answer ?? new Error('no ref');
      return answer;
    });

  it('origin/develop merge-base를 우선한다', () => {
    const git = runner({ 'origin/develop': 'aaa\n', 'origin/main': 'bbb\n' });
    expect(resolveBase(git)).toBe('aaa');
    expect(git).toHaveBeenCalledWith(['merge-base', 'HEAD', 'origin/develop']);
  });

  it('develop이 없으면 origin/main으로', () => {
    expect(resolveBase(runner({ 'origin/main': 'bbb\n' }))).toBe('bbb');
  });

  it('반증: 둘 다 실패하면 null(호출부가 full로 폴백)', () => {
    expect(resolveBase(runner({}))).toBeNull();
  });

  it('PRE_PUSH_BASE가 있으면 그 커밋을 기준으로 한다', () => {
    const git = jest.fn(() => 'ccc\n');
    expect(resolveBase(git, 'feat/stack-base')).toBe('ccc');
    expect(git).toHaveBeenCalledWith([
      'rev-parse',
      '--verify',
      'feat/stack-base^{commit}',
    ]);
  });

  it('반증: PRE_PUSH_BASE를 못 풀면 develop으로 넘어가지 않고 null', () => {
    const git = runner({ 'origin/develop': 'aaa\n' });
    expect(resolveBase(git, 'no-such-ref')).toBeNull();
    expect(git).toHaveBeenCalledTimes(1);
  });
});

describe('isGateSpec', () => {
  it.each([
    [
      'src/test/role-routes.spec.ts',
      "import { Test } from '@nestjs/testing';",
      true,
    ],
    [
      'src/features/review/repositories/review-lock-order.spec.ts',
      "import { readdirSync } from 'node:fs';",
      true,
    ],
    [
      'src/graphql/removed-schema-elements.spec.ts',
      "import { readFileSync } from 'fs';",
      true,
    ],
    ['src/features/x/x.spec.ts', "const fs = require('node:fs');", true],
    [
      'src/features/x/x.service.spec.ts',
      "import { Test } from '@nestjs/testing';",
      false,
    ],
    [
      'src/features/x/x.service.spec.ts',
      "import { join } from 'node:path';",
      false,
    ],
    [
      'src/test/model-ownership.helper.ts',
      "import { readdirSync } from 'node:fs';",
      false,
    ],
    [
      'src/features/x/fs-util.ts',
      "import { readFileSync } from 'node:fs';",
      false,
    ],
  ])('%s → %s', (path, source, expected) => {
    expect(isGateSpec(path, source)).toBe(expected);
  });
});

describe('pushedRefMismatch', () => {
  const HEAD = 'a'.repeat(40);
  const OTHER = 'b'.repeat(40);
  const ZERO = '0'.repeat(40);
  it.each([
    ['stdin 없음(직접 실행)', '', null],
    ['HEAD를 push', `refs/heads/x ${HEAD} refs/heads/x ${OTHER}`, null],
    ['브랜치 삭제는 무시', `(delete) ${ZERO} refs/heads/x ${OTHER}`, null],
    [
      '다른 ref를 push',
      `refs/heads/feature-x ${OTHER} refs/heads/feature-x ${ZERO}`,
      'push 대상 refs/heads/feature-x가 HEAD가 아님',
    ],
    [
      '여러 ref 중 하나라도 HEAD가 아니면',
      `refs/heads/x ${HEAD} refs/heads/x ${OTHER}\nrefs/heads/y ${OTHER} refs/heads/y ${ZERO}`,
      'push 대상 refs/heads/y가 HEAD가 아님',
    ],
  ])('%s', (_label, refs, expected) => {
    expect(pushedRefMismatch(refs, HEAD)).toBe(expected);
  });

  it('pre-push 훅이 stdin을 PRE_PUSH_REFS로 넘긴다', () => {
    const hook = readFileSync(
      join(__dirname, '..', '.husky', 'pre-push'),
      'utf8',
    );
    expect(hook).toMatch(/^PRE_PUSH_REFS=\$\(cat\)$/m);
    expect(hook).toMatch(/^export PRE_PUSH_REFS$/m);
    // 머리 주석에도 명령 이름이 나오므로 실행 줄(줄 시작)끼리 순서를 본다
    expect(hook.search(/^export PRE_PUSH_REFS$/m)).toBeLessThan(
      hook.search(/^yarn validate:push$/m),
    );
  });
});
