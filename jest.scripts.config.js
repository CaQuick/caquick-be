// scripts/ 전용 jest 설정.
//
// 왜 별도인가: package.json의 jest는 rootDir이 src라 scripts/ 아래 spec을 아예
// 수집하지 않는다. 앱 커버리지 임계치(statements 96 등)에 빌드 도구를 섞고 싶지도
// 않아서, 실행만 분리하고 커버리지 집계에서는 제외한다.
module.exports = {
  rootDir: 'scripts',
  testRegex: '.*\\.spec\\.ts$',
  // TS 6부터 출력 레이아웃 기준 디렉터리 명시가 필수(TS5011)라 rootDir을 준다.
  // emit하지 않는 검사 전용이지만 ts-jest도 같은 진단을 탄다.
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { rootDir: './scripts' } }],
  },
  testEnvironment: 'node',
};
