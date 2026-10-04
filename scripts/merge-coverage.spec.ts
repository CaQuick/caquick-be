import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import {
  createCoverageMap,
  type CoverageMapData,
  type FileCoverageData,
} from 'istanbul-lib-coverage';

import {
  loadThresholds,
  mergeCoverage,
  parseThresholds,
  type Thresholds,
} from './merge-coverage';

// CI coverage-report가 샤드 결과를 합쳐 임계를 거는 유일한 지점이다 — 부분 결과가 통과하지 못하는지가 본체다.
const ROOT = join(__dirname, '..');
const A = join(ROOT, 'src/a.ts');
const B = join(ROOT, 'src/b.ts');

const loc = (line: number) => ({
  start: { line, column: 0 },
  end: { line, column: 10 },
});

/** 문장 2·함수 1·분기 1(경로 2)인 파일. hits = [문장0, 문장1, 함수0, 분기 경로0, 분기 경로1] */
function file(path: string, hits: number[]): FileCoverageData {
  const [s0, s1, f0, b0, b1] = hits;
  return {
    path,
    statementMap: { 0: loc(1), 1: loc(2) },
    fnMap: { 0: { name: 'f', decl: loc(1), loc: loc(1), line: 1 } },
    branchMap: {
      0: { loc: loc(2), type: 'if', locations: [loc(2), loc(3)], line: 2 },
    },
    s: { 0: s0, 1: s1 },
    f: { 0: f0 },
    b: { 0: [b0, b1] },
  };
}
const FULL = [1, 1, 1, 1, 1];
const NONE = [0, 0, 0, 0, 0];
const PARTIAL = [1, 0, 1, 1, 0];

/** jest --json 출력의 모양. jest는 샤드가 읽지 않은 파일도 collectCoverageFrom으로 0을 채워 넣는다 */
function shard(
  files: FileCoverageData[],
  { passed, failed = 0 }: { passed: number; failed?: number },
): Record<string, unknown> {
  return {
    success: failed === 0,
    startTime: 1000 + passed,
    numTotalTests: passed + failed,
    numPassedTests: passed,
    numFailedTests: failed,
    numRuntimeErrorTestSuites: 0,
    snapshot: { failure: false, total: 0 },
    testResults: [
      {
        name: join(ROOT, `src/${passed}-${failed}.spec.ts`),
        assertionResults: [
          { status: failed ? 'failed' : 'passed', title: '케이스' },
        ],
      },
    ],
    coverageMap: Object.fromEntries(files.map((f) => [f.path, f])),
  };
}

const LOOSE: Thresholds = {
  statements: 75,
  branches: 75,
  functions: 100,
  lines: 75,
};

describe('merge-coverage', () => {
  let shardDir: string;
  let outDir: string;
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'merge-coverage-'));
    shardDir = join(dir, 'shards');
    outDir = join(dir, 'out');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const put = (n: number, report: Record<string, unknown>) => {
    mkdirSync(join(shardDir, `coverage-shard-${n}`), { recursive: true });
    writeFileSync(
      join(shardDir, `coverage-shard-${n}`, 'report.json'),
      JSON.stringify(report),
    );
  };
  const report = () =>
    JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')) as Record<
      string,
      unknown
    > & { coverageMap: CoverageMapData; testResults: unknown[] };
  const merge = (shardTotal: number, thresholds: Thresholds) =>
    mergeCoverage({ shardDir, outDir, shardTotal, thresholds });

  it('두 샤드를 합치면 한 번에 돈 결과와 수치가 같고, 테스트 수를 더해 report.json·coverage-final.json·lcov.info를 쓴다', () => {
    put(1, shard([file(A, FULL), file(B, NONE)], { passed: 2 }));
    put(2, shard([file(A, NONE), file(B, PARTIAL)], { passed: 3 }));
    const single = createCoverageMap({
      [A]: file(A, FULL),
      [B]: file(B, PARTIAL),
    })
      .getCoverageSummary()
      .toJSON();

    expect(merge(2, LOOSE)).toEqual({ errors: [], summary: single });
    expect(single.statements).toMatchObject({ covered: 3, total: 4, pct: 75 });
    const merged = report();
    expect(merged).toMatchObject({
      success: true,
      startTime: 1002,
      numTotalTests: 5,
      numPassedTests: 5,
      numFailedTests: 0,
      snapshot: { failure: false, total: 0 },
    });
    expect(merged.testResults).toHaveLength(2);
    expect(
      createCoverageMap(merged.coverageMap).getCoverageSummary().toJSON(),
    ).toEqual(single);
    expect(existsSync(join(outDir, 'coverage-final.json'))).toBe(true);
    // Codecov가 받는 경로는 지금처럼 저장소 루트 기준 상대 경로
    expect(readFileSync(join(outDir, 'lcov.info'), 'utf8')).toContain(
      `SF:${relative(process.cwd(), B)}\n`,
    );
  });

  it('반증: 샤드 하나만으로는 임계 미달로 실패한다 — 다른 샤드가 덮은 파일이 0으로 잡힌다', () => {
    put(1, shard([file(A, FULL), file(B, NONE)], { passed: 2 }));

    expect(merge(1, LOOSE).errors).toEqual([
      'statements 50% — 임계 75% 미달',
      'branches 50% — 임계 75% 미달',
      'functions 50% — 임계 100% 미달',
      'lines 50% — 임계 75% 미달',
    ]);
  });

  it('반증: 샤드 결과가 모자라면 실패하고 report.json의 success도 거짓으로 쓴다', () => {
    put(1, shard([file(A, FULL), file(B, FULL)], { passed: 2 }));

    expect(merge(2, {}).errors).toEqual(['샤드 결과 1개 — 2개여야 한다']);
    expect(report().success).toBe(false);
  });

  it('반증: 실패한 테스트가 있으면 실패하고, 그때도 report.json을 써서 실패 내역을 남긴다', () => {
    put(1, shard([file(A, FULL), file(B, NONE)], { passed: 2 }));
    put(2, shard([file(A, NONE), file(B, FULL)], { passed: 2, failed: 1 }));

    expect(merge(2, LOOSE).errors).toEqual([
      '테스트 실패 — 실패 1건, 실행 오류 스위트 0개',
    ]);
    const merged = report();
    expect(merged).toMatchObject({
      success: false,
      numFailedTests: 1,
      numTotalTests: 5,
    });
    expect(merged.testResults[1]).toMatchObject({
      assertionResults: [{ status: 'failed' }],
    });
  });

  it('반증: coverageMap이 없는 샤드는 실패한다 — 빈 맵은 istanbul이 임계 비교를 통과하는 값으로 센다', () => {
    put(1, { ...shard([], { passed: 2 }), coverageMap: undefined });

    expect(merge(1, { statements: 1 }).errors).toEqual([
      'coverageMap이 없는 샤드가 있다(--coverage 누락)',
      'statements Unknown% — 임계 1% 미달',
    ]);
  });

  describe('CLI(yarn coverage:merge) 종료 코드 — CI 잡의 성패가 이것으로 갈린다', () => {
    it.each([
      ['샤드가 다 있고 jest.config.js 임계를 넘으면 0', [1, 2], '2', 0, true],
      ['반증: 샤드가 모자라면 1, report.json은 남는다', [1], '2', 1, true],
      ['반증: SHARD_TOTAL이 없으면 2', [1, 2], '', 2, false],
    ])(
      '%s',
      (_label, shards, total, status, written) => {
        if (shards.includes(1))
          put(1, shard([file(A, FULL), file(B, NONE)], { passed: 1 }));
        if (shards.includes(2))
          put(2, shard([file(A, NONE), file(B, FULL)], { passed: 1 }));

        const result = spawnSync('yarn', ['coverage:merge', shardDir, outDir], {
          cwd: ROOT,
          env: { ...process.env, SHARD_TOTAL: total },
          encoding: 'utf8',
        });

        expect({ status: result.status, stderr: result.stderr }).toMatchObject({
          status,
        });
        expect(existsSync(join(outDir, 'report.json'))).toBe(written);
      },
      60_000,
    );
  });
});

describe('임계 설정', () => {
  it('jest.config.js의 global 임계를 그대로 읽는다', () => {
    const config = require('../jest.config.js') as {
      coverageThreshold: { global: Thresholds };
    };
    expect(loadThresholds()).toEqual(config.coverageThreshold.global);
  });

  it.each([
    [undefined],
    [{}],
    [{ global: {} }],
    [{ global: { statements: 90 }, './src/a.ts': { lines: 90 } }],
    [{ global: { statements: -10 } }],
    [{ global: { statement: 90 } }],
    [{ global: { lines: '90' } }],
  ])(
    '반증: %j는 거절한다 — 여기서 검사하지 못하는 형식을 조용히 통과시키지 않는다',
    (config) => {
      expect(() => parseThresholds(config)).toThrow(
        '지원하지 않는 coverageThreshold',
      );
    },
  );
});
