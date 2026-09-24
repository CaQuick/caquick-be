import {
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
});
