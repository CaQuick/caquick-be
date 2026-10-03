// jest.config.js의 변환 모드 판정. 커버리지 실행만 LanguageService 모드(isolatedModules:false)여야 branches 임계가 맞는다.

interface AppJestConfig {
  transform: Record<
    string,
    [string, { tsconfig: { isolatedModules: boolean } }]
  >;
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
