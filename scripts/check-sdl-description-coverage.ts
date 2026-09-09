/**
 * SDL description 커버리지 게이트.
 *
 * 왜: 설명 없는 필드를 추가해도 CI가 통과한다. dto:check가 SDL↔DTO 동기화를
 * 도구로 강제하듯, 문서 커버리지도 게이트로 받친다. (이슈 #250)
 *
 * 운용 방침: 요소별 임계치를 **현재 달성치로 고정**해 회귀만 차단한다. 신규 API에는
 * 문서화를 강제하고, 남은 부채는 임계치를 올려가며 갚는다. 커버리지를 올렸다면
 * THRESHOLDS도 함께 올린다 — `--report`가 현재 수치를 그대로 뽑아 준다.
 *
 * 사용: yarn docs:check [--report] [--warning]
 *   --report   임계치 검사 없이 현재 커버리지만 출력 (임계치 갱신용)
 *   --warning  미달이어도 종료코드 0 (CI 경고용)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import type { Baseline, Category, SdlFile } from './sdl-description-coverage';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  collectCoverage,
  findViolations,
  missingCountOf,
  percentOf,
} from './sdl-description-coverage';

const REPO_ROOT = resolve(__dirname, '..');
const SDL_ROOT = join(REPO_ROOT, 'src');
const SDL_FILE_EXT = '.graphql';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.yarn']);

/**
 * 회귀 차단 기준선. 2026-09-10 실측 스냅샷을 {문서화된 수, 전체 수} 그대로 둔다.
 *
 * 왜 정수 %가 아닌 분수인가: 임계치를 내림하면 그만큼 여유분이 생겨 회귀가 통과한다.
 * 예컨대 출력 필드 185/603(30.68%)에 임계 30%를 걸면 미기재 13건을 더 넣어도
 * 185/616 = 30.03%라 게이트를 빠져나간다. 분수를 그대로 기준으로 삼아야
 * "커버리지 비율이 내려가면 실패"가 성립한다.
 *
 * 자명한 필드(id·createdAt·*Id)는 분모에서 빠지고, 타입 이름만 되풀이하는
 * 플레이스홀더 설명은 미기재로 센다.
 *
 * 커버리지를 올렸다면 `yarn docs:check --report`가 찍어 주는 수치로 갱신한다.
 */
const BASELINE: Record<Category, Baseline> = {
  rootField: { documented: 130, total: 130 },
  rootArgScalar: { documented: 0, total: 6 },
  inputType: { documented: 13, total: 72 },
  inputField: { documented: 49, total: 227 },
  outputType: { documented: 67, total: 134 },
  outputField: { documented: 185, total: 603 },
  enumType: { documented: 12, total: 23 },
  enumValue: { documented: 10, total: 81 },
};

const args = new Set(process.argv.slice(2));
const REPORT_ONLY = args.has('--report');
const WARNING_ONLY = args.has('--warning');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (extname(full) === SDL_FILE_EXT) out.push(full);
  }
  return out;
}

function loadSdlFiles(): SdlFile[] {
  if (!safeIsDir(SDL_ROOT)) return [];
  return walk(SDL_ROOT)
    .sort()
    .map((file) => ({
      path: relative(SDL_ROOT, file),
      sdl: readFileSync(file, 'utf8'),
    }));
}

function safeIsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function main(): void {
  const files = loadSdlFiles();
  const coverage = collectCoverage(files);

  console.log(`[docs:check] SDL 파일 ${files.length}개`);
  console.log('');
  for (const category of CATEGORIES) {
    const stat = coverage[category];
    const baseline = BASELINE[category];
    const actual = percentOf(stat);
    const threshold = percentOf({ ...baseline, missing: [] });
    const label = CATEGORY_LABELS[category].padEnd(22, ' ');
    const ratio = `${String(stat.documented)}/${String(stat.total)}`.padStart(9);
    console.log(
      `  ${label}${ratio}  ${actual.toFixed(1).padStart(5)}%  ` +
        `(기준 ${String(baseline.documented)}/${String(baseline.total)} = ${threshold.toFixed(1)}%, ` +
        `미기재 ${String(stat.missing.length)}/${String(missingCountOf(baseline))})`,
    );
  }
  console.log('');

  if (REPORT_ONLY) {
    console.log('[docs:check] --report 모드: 임계치 검사를 건너뜁니다.');
    return;
  }

  const violations = findViolations(coverage, BASELINE);
  if (violations.length === 0) {
    console.log('[docs:check] 통과');
    return;
  }

  for (const violation of violations) {
    const detail =
      violation.reason === 'count'
        ? `미기재 ${String(violation.actualMissing)}건 > 기준선 ${String(violation.baselineMissing)}건`
        : `커버리지 ${violation.actual.toFixed(1)}% < 기준선 ${violation.threshold.toFixed(1)}%`;
    console.error(
      `\n[DOC_COVERAGE_REGRESSION] ${CATEGORY_LABELS[violation.category]}: ${detail}`,
    );
    console.error(`  설명이 없는 요소 ${String(violation.missing.length)}건:`);
    for (const item of violation.missing) {
      console.error(`    - ${item}`);
    }
  }

  console.error(
    `\n[docs:check] ${String(violations.length)}개 항목이 임계치 미달입니다.`,
  );
  if (!WARNING_ONLY) process.exitCode = 1;
}

main();
