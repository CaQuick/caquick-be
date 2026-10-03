import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// jest.config.js의 변환 모드 판정. 커버리지 실행만 LanguageService 모드(isolatedModules:false)여야 branches 임계가 맞는다.

interface AppJestConfig {
  transform: Record<
    string,
    [string, { tsconfig: { isolatedModules: boolean } }]
  >;
  maxWorkers?: number;
}

/** env.CI를 바꿔 jest.config.js를 새로 읽는다. 키가 없으면 'absent'(jest 설정 검증은 undefined 값을 거절한다). */
function maxWorkersFor(ci: string | undefined): number | 'absent' {
  const saved = process.env.CI;
  if (ci === undefined) delete process.env.CI;
  else process.env.CI = ci;
  try {
    let config: AppJestConfig | undefined;
    jest.isolateModules(() => {
      config = require('../jest.config.js') as AppJestConfig;
    });
    return 'maxWorkers' in config! ? config.maxWorkers! : 'absent';
  } finally {
    if (saved === undefined) delete process.env.CI;
    else process.env.CI = saved;
  }
}

/** argv를 바꿔 jest.config.js를 새로 읽는다(설정은 로드 시점의 process.argv로 모드를 정한다). */
function isolatedModulesFor(args: string[]): boolean {
  const saved = process.argv;
  process.argv = ['node', 'jest', ...args];
  try {
    let config: AppJestConfig | undefined;
    jest.isolateModules(() => {
      config = require('../jest.config.js') as AppJestConfig;
    });
    const [, options] = config!.transform['^.+\\.(t|j)s$'];
    return options.tsconfig.isolatedModules;
  } finally {
    process.argv = saved;
  }
}

describe('jest.config.js 변환 모드', () => {
  it.each([
    ['--coverage'],
    ['--coverage=true'],
    ['--collectCoverage'],
    ['--collectCoverage=true'],
    ['--collect-coverage'],
    ['--collect-coverage=true'],
  ])('%s면 커버리지 실행이라 LanguageService 모드', (flag) => {
    expect(isolatedModulesFor(['--ci', flag])).toBe(false);
  });

  it.each([
    [[]],
    [['--coverage=false']],
    [['--collectCoverage=false']],
    [['--collect-coverage=false']],
    [['--no-coverage']],
    [['--coverageProvider=v8']],
    [['--coverageDirectory=coverage']],
    [['src/features/region/coverage.spec.ts']],
    [['--maxWorkers=4', '--ci']],
  ])('%j면 transpile 모드', (args) => {
    expect(isolatedModulesFor(args)).toBe(true);
  });
});

describe('jest.config.js 워커 수', () => {
  it('로컬(운영 맥미니)은 4개로 제한한다', () => {
    expect(maxWorkersFor(undefined)).toBe(4);
  });

  it('CI는 러너 기본값을 쓴다 — 키 자체를 넣지 않는다', () => {
    expect(maxWorkersFor('true')).toBe('absent');
  });
});

// 값 판정만 보면 jest 자체의 설정 검증(예: undefined 값 거절)을 놓친다 — 실제 jest가 설정을 받아들이는지 본다
describe('jest.config.js가 jest 설정 검증을 통과한다', () => {
  it.each([
    ['로컬', { CI: '' }],
    ['CI', { CI: 'true' }],
  ])('%s', (_label, env) => {
    const result = spawnSync('npx', ['jest', '--showConfig'], {
      cwd: join(__dirname, '..'),
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });

    expect(result.stderr).not.toMatch(/Validation Error/);
    expect(result.status).toBe(0);
  });
});
