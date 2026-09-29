/**
 * pre-push 테스트 계획 — 기준 커밋 대비 변경으로 jest 범위(full·related·none)를 고른다.
 *
 * 왜: 전체 jest(실DB 스위트 포함)는 운영과 같은 맥미니에서 5.7~12.7분을 쓰고 운영 컨테이너와
 * CPU·메모리를 다툰다. 전체 회귀·커버리지는 CI `check`가 필수 체크로 이미 돌리므로, 로컬은
 * import 그래프로 닿는 spec만 돌리고 그래프가 못 보는 변경은 보수적으로 전체로 되돌린다.
 *
 * 사용: yarn test:push  (yarn validate:push의 마지막 단계)
 *   --dry-run            계획과 jest 명령만 출력
 *   PRE_PUSH_BASE=<ref>  기준 커밋 지정(기본: origin/develop, 없으면 origin/main과의 merge-base)
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export interface Change {
  path: string;
  /** git diff --name-status의 첫 글자(A·M·D·T…). 이름 변경·복사는 parseNameStatus가 A/D로 풀어 둔다. */
  status: string;
}

export type TestPlan =
  | { mode: 'full'; reasons: string[] }
  | { mode: 'related'; files: string[] }
  | { mode: 'none' };

/** 이보다 많으면 related도 사실상 전체라 그래프 누락 위험만 남는다. */
export const RELATED_LIMIT = 40;

const FULL_RULES: [RegExp, string][] = [
  [/\.graphql$/, 'SDL은 import 그래프 밖에서 스키마로 로드된다'],
  [
    /^prisma\/|^prisma\.config\.ts$/,
    'prisma 스키마·마이그레이션·시드는 실DB 스위트 전체의 전제다',
  ],
  [/^src\/test\/|^test\//, '테스트 인프라·팩토리·전역 게이트가 바뀌었다'],
  [/^package\.json$/, 'jest 설정·의존성이 package.json에 있다'],
  [/^yarn\.lock$|^\.yarnrc\.yml$|^\.yarn\//, '의존성이 바뀌었다'],
  [/^tsconfig[^/]*\.json$/, '컴파일 설정이 바뀌었다'],
  [
    /^src\/(config|global)\/|^src\/(app\.module|main)\.ts$/,
    '전역 배선은 모듈 배선 spec 전반에 닿는다',
  ],
];

// jest 본 스위트가 읽지 않는 것만 — 목록에 없는 파일은 전체로 간다(.gitignore·nest-cli.json은 build-config.spec이 읽는다).
const NONE_RULES: RegExp[] = [
  /\.md$/,
  /^(docs|\.github|infra|terraform|docker|\.husky|\.vscode)\//,
  // scripts/*.spec은 validate:push의 test:scripts가 전부 돌리고, src는 scripts를 import하지 않는다.
  /^scripts\//,
  /^(Dockerfile|docker-compose\.yml|\.dockerignore|jest\.scripts\.config\.js|LICENSE|\.nvmrc)$/,
  /^(eslint\.config\.mjs|\.prettierrc|\.prettierignore|knip\.json|commitlint\.config\.mjs)$/,
  /^(\.coderabbit\.yaml|codecov\.yml|spectaql\.yml|\.dependency-cruiser\.cjs)$/,
];

const SNAPSHOT = /^(src\/.+)\/__snapshots__\/(.+\.spec\.ts)\.snap$/;

type Verdict = { full: string } | { related: string } | 'none';

function classify({ path, status }: Change): Verdict {
  for (const [pattern, reason] of FULL_RULES) {
    if (pattern.test(path)) return { full: `${path}: ${reason}` };
  }
  if (/^src\/.+\.ts$/.test(path)) {
    return status === 'D'
      ? {
          full: `${path}: 삭제·이름 변경된 모듈의 사용처 spec은 find-related로 찾을 수 없다`,
        }
      : { related: path };
  }
  const snapshot = SNAPSHOT.exec(path);
  if (snapshot) return { related: `${snapshot[1]}/${snapshot[2]}` };
  if (NONE_RULES.some((pattern) => pattern.test(path))) return 'none';
  return { full: `${path}: 분류되지 않은 파일은 보수적으로 전체` };
}

/**
 * @param gateSpecs 소스를 파일로 읽어 검사하는 spec — import 그래프로 이어지지 않아 related일 때 항상 붙인다.
 */
export function planTests(
  changes: Change[],
  gateSpecs: string[] = [],
): TestPlan {
  const reasons: string[] = [];
  const related = new Set<string>();
  for (const change of changes) {
    const verdict = classify(change);
    if (verdict === 'none') continue;
    if ('full' in verdict) reasons.push(verdict.full);
    else related.add(verdict.related);
  }
  if (related.size > RELATED_LIMIT) {
    reasons.push(`src 변경 ${related.size}개 > ${RELATED_LIMIT}개`);
  }
  if (reasons.length > 0) return { mode: 'full', reasons };
  if (related.size === 0) return { mode: 'none' };
  return { mode: 'related', files: [...new Set([...related, ...gateSpecs])] };
}

/** 이름 변경·복사는 옛 경로 삭제 + 새 경로 추가로 푼다 — 옛 경로의 사용처가 계획에 들어가야 한다. */
export function parseNameStatus(output: string): Change[] {
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      const [code, first, second] = line.split('\t');
      const status = code[0];
      if (status === 'R')
        return [
          { path: first, status: 'D' },
          { path: second, status: 'A' },
        ];
      if (status === 'C') return [{ path: second, status: 'A' }];
      return [{ path: first, status }];
    });
}

export const BASE_REFS = ['origin/develop', 'origin/main'];

/**
 * 기준을 못 구하면 null — 호출부가 전체로 폴백한다.
 * @param override PRE_PUSH_BASE — 스택 PR처럼 기준이 develop이 아닐 때. 못 풀면 후보로 넘어가지 않고 null.
 */
export function resolveBase(
  git: (args: string[]) => string,
  override?: string,
): string | null {
  const attempts = override
    ? [['rev-parse', '--verify', `${override}^{commit}`]]
    : BASE_REFS.map((ref) => ['merge-base', 'HEAD', ref]);
  for (const args of attempts) {
    try {
      return git(args).trim();
    } catch {
      // 다음 후보로
    }
  }
  return null;
}

/** src/test 아래 spec과 fs를 import하는 spec(소스·SDL·마이그레이션을 파일로 읽는 게이트). */
export function isGateSpec(path: string, source: string): boolean {
  if (!path.endsWith('.spec.ts')) return false;
  return (
    path.startsWith('src/test/') ||
    /from '(node:)?fs'|require\('(node:)?fs'\)/.test(source)
  );
}

const REPO_ROOT = resolve(__dirname, '..');

function listSpecs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === 'generated' ? [] : listSpecs(full);
    return entry.name.endsWith('.spec.ts') ? [relative(REPO_ROOT, full)] : [];
  });
}

function gitRunner(args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** 작업 트리 기준 diff — jest가 도는 것도 디스크의 파일이라 커밋 안 된 변경까지 같이 본다. */
function computePlan(): { plan: TestPlan; base: string | null } {
  const override = process.env.PRE_PUSH_BASE || undefined;
  const base = resolveBase(gitRunner, override);
  if (base === null) {
    return {
      base,
      plan: {
        mode: 'full',
        reasons: [
          `기준 커밋 없음(${override ?? BASE_REFS.join('·')} 해석 실패)`,
        ],
      },
    };
  }
  let changes: Change[];
  try {
    changes = parseNameStatus(gitRunner(['diff', '--name-status', '-M', base]));
  } catch (error) {
    return {
      base,
      plan: { mode: 'full', reasons: [`git diff 실패: ${String(error)}`] },
    };
  }
  const gateSpecs = listSpecs(join(REPO_ROOT, 'src')).filter((path) =>
    isGateSpec(path, readFileSync(join(REPO_ROOT, path), 'utf8')),
  );
  return { base, plan: planTests(changes, gateSpecs) };
}

function main(): void {
  const { plan, base } = computePlan();
  const from = base ? ` (기준 ${base.slice(0, 7)})` : '';
  let args: string[];
  if (plan.mode === 'none') {
    console.log(
      `[pre-push-test-plan] none${from}: jest 본 스위트에 닿는 변경 없음`,
    );
    return;
  }
  if (plan.mode === 'full') {
    console.log(
      `[pre-push-test-plan] full${from}: ${plan.reasons.join(' / ')}`,
    );
    args = [];
  } else {
    const files = plan.files.filter((file) =>
      existsSync(join(REPO_ROOT, file)),
    );
    console.log(
      `[pre-push-test-plan] related${from}: ${files.length}개 파일(게이트 spec 포함)에 닿는 spec만`,
    );
    args = [
      '--findRelatedTests',
      ...files.map((file) => join(REPO_ROOT, file)),
      '--passWithNoTests',
    ];
  }
  if (process.argv.includes('--dry-run')) {
    console.log(`yarn jest ${args.join(' ')}`);
    return;
  }
  const result = spawnSync('yarn', ['jest', ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

if (require.main === module) main();
