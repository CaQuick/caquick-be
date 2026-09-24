import {
  appRoleLabel,
  isWorkerRouteAllowed,
  parseAppRole,
  resolveAppRole,
  runsBackgroundJobs,
  servesHttpApi,
} from '@/config/app.config';

describe('appConfig', () => {
  const saved = process.env.APP_ROLE;
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_ROLE;
    else process.env.APP_ROLE = saved;
  });

  it.each([
    [undefined, 'api'],
    ['', 'api'],
    ['api', 'api'],
    [' WS ', 'ws'],
    ['Worker', 'worker'],
  ])('%p → %s', (raw, expected) => {
    expect(parseAppRole(raw)).toBe(expected);
  });

  it('appRoleLabel은 검증 없이 원값(소문자)을 돌려준다 — import 시점(로거)에 던지지 않게', () => {
    process.env.APP_ROLE = ' Bogus ';
    expect(appRoleLabel()).toBe('bogus');
    delete process.env.APP_ROLE;
    expect(appRoleLabel()).toBe('api');
  });

  it('반증: 모르는 역할은 기본값으로 숨기지 않고 던진다', () => {
    expect(() => parseAppRole('cron')).toThrow('APP_ROLE');
    process.env.APP_ROLE = 'batch';
    expect(() => resolveAppRole()).toThrow('batch');
  });

  // 역할별 책임 전수 — 한 역할에 책임이 둘 다 붙거나 둘 다 빠지면 여기서 드러난다.
  it.each([
    ['api', true, false],
    ['ws', true, false],
    ['worker', false, true],
  ] as const)('%s: http=%s, background=%s', (role, http, background) => {
    expect(servesHttpApi(role)).toBe(http);
    expect(runsBackgroundJobs(role)).toBe(background);
  });

  // worker 허용 경로 표 — 접두 일치만 허용하고 비슷한 이름(/healthz)·다른 컨트롤러는 막는다.
  it.each([
    ['/health', true],
    ['/health/ready', true],
    ['/metrics', true],
    ['/Health/', true],
    ['/METRICS', true],
    ['/healthz', false],
    ['/health-check', false],
    ['/auth/oidc/google/start', false],
    ['/.well-known/jwks.json', false],
    ['/graphql', false],
    ['/', false],
  ])('worker 라우트 %s → %s', (path, allowed) => {
    expect(isWorkerRouteAllowed(path)).toBe(allowed);
  });
});
