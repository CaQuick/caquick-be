// 앱(src) jest 설정. scripts/ spec은 jest.scripts.config.js가 따로 돈다.
//
// ts-jest 변환 모드를 커버리지 여부로 가른다.
// - 커버리지 실행(CI test:cov·coverage-report): LanguageService 모드(isolatedModules:false). transpile 모드의 데코레이터
//   메타데이터 가드식(`typeof X !== "undefined" && X`)이 분기로 잡혀 branches 임계가 깨진다(a93efac).
// - 나머지(pre-push·경로 지정 실행): transpile 모드. LanguageService 모드는 파일마다 타입 검사를 하고 캐시 키에 전이 의존
//   파일의 mtime을 넣어 콜드 실행이 3배 이상 느리다. 타입 검사는 validate:push·CI의 tsc --noEmit이 한다.
const coverage = process.argv.some(
  (arg) => arg === '--coverage' || arg === '--coverage=true',
);

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        // transpile 모드는 tsconfig의 nodenext를 그대로 써 동적 import()가 남는다(Prisma 클라이언트가 jest vm에서 실패) —
        // LanguageService 모드처럼 CommonJS로 내보낸다. rootDir은 TS 6의 TS5011(출력 레이아웃 기준 명시) 때문이다
        tsconfig: coverage
          ? { isolatedModules: false }
          : {
              isolatedModules: true,
              module: 'commonjs',
              moduleResolution: 'bundler',
              rootDir: '.',
            },
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/index.ts',
    '!**/main.ts',
    '!**/*.module.ts',
    '!**/*.d.ts',
    '!**/graphql/graphql.types.ts',
    '!**/generated/**',
    '!**/config/**',
    '!test/**',
  ],
  coverageThreshold: {
    global: { statements: 96, branches: 86, functions: 92, lines: 96 },
  },
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/jest.global-setup.ts',
  globalTeardown: '<rootDir>/test/jest.global-teardown.ts',
  testTimeout: 60000,
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  setupFilesAfterEnv: ['<rootDir>/test/matchers/domain-error.matcher.ts'],
};
