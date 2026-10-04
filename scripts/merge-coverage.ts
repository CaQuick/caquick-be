/**
 * CI 테스트 샤드의 jest --json 결과를 한 벌로 합친다 — 커버리지 맵 병합, 테스트 결과 합산, 임계 검사.
 *
 * 왜: 샤드 하나의 커버리지는 다른 샤드가 덮은 파일을 0으로 세서 임계와 비교할 수 없다. 그래서 샤드는 임계를 끄고
 * ('--coverageThreshold={}') 돌리고, 임계는 합친 맵으로 여기서 검사한다. 값은 jest.config.js 한 곳에서 읽는다.
 *
 * 사용: SHARD_TOTAL=<샤드 수> yarn coverage:merge <샤드 디렉터리> <출력 디렉터리>
 *   샤드 디렉터리의 하위 폴더마다 report.json(jest --coverage --json --testLocationInResults 출력)이 있어야 한다.
 *   출력은 report.json(jest-coverage-report-action 입력)·coverage-final.json·lcov.info.
 *   테스트 실패·샤드 누락·임계 미달이면 exit 1 — 그때도 report.json은 먼저 써서 PR 댓글에 실패가 보이게 한다.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  createCoverageMap,
  type CoverageMapData,
  type CoverageSummaryData,
} from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import { create } from 'istanbul-reports';

const METRICS = ['statements', 'branches', 'functions', 'lines'] as const;
export type Thresholds = Partial<Record<(typeof METRICS)[number], number>>;

type Report = Record<string, unknown> & { coverageMap?: CoverageMapData };

export interface MergeResult {
  errors: string[];
  summary: CoverageSummaryData;
}

/** jest coverageThreshold에서 global의 양수 퍼센트만 받는다 — 경로별 그룹·음수(미커버 개수)는 여기서 검사하지 못해 거절한다. */
export function parseThresholds(coverageThreshold: unknown): Thresholds {
  const { global, ...rest } = (coverageThreshold ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const entries = Object.entries(global ?? {});
  const ok =
    Object.keys(rest).length === 0 &&
    entries.length > 0 &&
    entries.every(
      ([key, value]) =>
        (METRICS as readonly string[]).includes(key) &&
        typeof value === 'number' &&
        value > 0,
    );
  if (!ok) {
    throw new Error(
      `지원하지 않는 coverageThreshold: ${JSON.stringify(coverageThreshold)}`,
    );
  }
  return global;
}

export function loadThresholds(): Thresholds {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config = require('../jest.config.js') as {
    coverageThreshold?: unknown;
  };
  return parseThresholds(config.coverageThreshold);
}

/** 수는 더하고(startTime은 가장 이른 값), success는 AND, 다른 참/거짓은 OR, 배열은 잇고, 객체(snapshot)는 같은 규칙으로 */
function combine(a: unknown, b: unknown, key: string): unknown {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (key === 'startTime') return Math.min(Number(a), Number(b));
  if (key === 'success') return a === true && b === true;
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a || b;
  if (Array.isArray(a) && Array.isArray(b))
    return [...(a as unknown[]), ...(b as unknown[])];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    return Object.fromEntries(
      [...keys].map((k) => [k, combine(x[k], y[k], k)]),
    );
  }
  return a;
}

function readShards(shardDir: string): Report[] {
  if (!existsSync(shardDir)) return [];
  return readdirSync(shardDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(shardDir, entry.name, 'report.json'))
    .filter((file) => existsSync(file))
    .sort()
    .map((file) => JSON.parse(readFileSync(file, 'utf8')) as Report);
}

export function mergeCoverage(opts: {
  shardDir: string;
  outDir: string;
  shardTotal: number;
  thresholds: Thresholds;
}): MergeResult {
  const shards = readShards(opts.shardDir);
  const errors: string[] = [];
  if (shards.length !== opts.shardTotal) {
    errors.push(`샤드 결과 ${shards.length}개 — ${opts.shardTotal}개여야 한다`);
  }
  // 맵 없는 샤드는 그 샤드가 덮은 파일이 빠진 채 합쳐진다 — 커버리지를 안 잰 실행을 통과시키지 않는다
  if (shards.some((shard) => !shard.coverageMap)) {
    errors.push('coverageMap이 없는 샤드가 있다(--coverage 누락)');
  }

  const map = createCoverageMap({});
  for (const shard of shards) map.merge(shard.coverageMap ?? {});
  const tests = shards
    .map(({ coverageMap: _coverageMap, ...rest }) => rest)
    .reduce<Record<string, unknown>>(
      (acc, shard) => combine(acc, shard, '') as Record<string, unknown>,
      {},
    );
  const passed = tests.success === true && errors.length === 0;
  if (shards.length > 0 && tests.success !== true) {
    errors.push(
      `테스트 실패 — 실패 ${Number(tests.numFailedTests ?? 0)}건, 실행 오류 스위트 ${Number(tests.numRuntimeErrorTestSuites ?? 0)}개`,
    );
  }

  mkdirSync(opts.outDir, { recursive: true });
  writeFileSync(
    join(opts.outDir, 'report.json'),
    JSON.stringify({ ...tests, success: passed, coverageMap: map.toJSON() }),
  );
  const context = createContext({ dir: opts.outDir, coverageMap: map });
  create('json').execute(context);
  create('lcovonly').execute(context);

  const summary = map.getCoverageSummary().toJSON();
  for (const [metric, min] of Object.entries(opts.thresholds)) {
    const { pct } = summary[metric as keyof CoverageSummaryData];
    // 빈 맵의 pct는 'Unknown'(문자열)이라 pct < min이 거짓이 된다 — 부정형으로 비교해 미달로 센다
    if (!(pct >= min)) errors.push(`${metric} ${pct}% — 임계 ${min}% 미달`);
  }
  return { errors, summary };
}

function main(): void {
  const [shardDir, outDir] = process.argv.slice(2);
  const shardTotal = Number(process.env.SHARD_TOTAL);
  if (!shardDir || !outDir || !Number.isInteger(shardTotal) || shardTotal < 1) {
    console.error(
      '사용: SHARD_TOTAL=<샤드 수> yarn coverage:merge <샤드 디렉터리> <출력 디렉터리>',
    );
    process.exit(2);
  }
  const thresholds = loadThresholds();
  const { errors, summary } = mergeCoverage({
    shardDir,
    outDir,
    shardTotal,
    thresholds,
  });
  for (const metric of METRICS) {
    const { covered, total, pct } = summary[metric];
    const min = thresholds[metric];
    console.log(
      `${metric.padEnd(10)} ${pct}% (${covered}/${total})${min ? ` 임계 ${min}%` : ''}`,
    );
  }
  for (const error of errors) console.error(`✖ ${error}`);
  process.exit(errors.length > 0 ? 1 : 0);
}

if (require.main === module) main();
