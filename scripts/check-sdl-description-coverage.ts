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

import type { Category, SdlFile } from './sdl-description-coverage';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  collectCoverage,
  findViolations,
  percentOf,
} from './sdl-description-coverage';

const REPO_ROOT = resolve(__dirname, '..');
const SDL_ROOT = join(REPO_ROOT, 'src');
const SDL_FILE_EXT = '.graphql';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.yarn']);

/**
 * 요소별 최소 커버리지(%).
 *
 * 2026-09-10 기준 실측치로 고정했다. 자명한 필드(id·createdAt·*Id)는 분모에서
 * 빠지고, 타입 이름만 되풀이하는 플레이스홀더 설명은 미기재로 센다.
 */
const THRESHOLDS: Record<Category, number> = {
  rootField: 100,
  rootArgScalar: 0,
  inputType: 18,
  inputField: 21,
  outputType: 49,
  outputField: 30,
  enumType: 52,
  enumValue: 12,
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
    const actual = percentOf(stat);
    const threshold = THRESHOLDS[category];
    const label = CATEGORY_LABELS[category].padEnd(22, ' ');
    const ratio = `${String(stat.documented)}/${String(stat.total)}`.padStart(9);
    console.log(
      `  ${label}${ratio}  ${actual.toFixed(1).padStart(5)}%  (임계 ${String(threshold)}%)`,
    );
  }
  console.log('');

  if (REPORT_ONLY) {
    console.log('[docs:check] --report 모드: 임계치 검사를 건너뜁니다.');
    return;
  }

  const violations = findViolations(coverage, THRESHOLDS);
  if (violations.length === 0) {
    console.log('[docs:check] 통과');
    return;
  }

  for (const violation of violations) {
    console.error(
      `\n[COVERAGE_BELOW_THRESHOLD] ${CATEGORY_LABELS[violation.category]}: ` +
        `${violation.actual.toFixed(1)}% < ${String(violation.threshold)}%`,
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
