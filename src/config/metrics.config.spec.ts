import metricsConfig from '@/config/metrics.config';

describe('metricsConfig', () => {
  const env: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ['NODE_ENV', 'METRICS_ACCESS_TOKEN']) {
      env[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('토큰을 읽는다(공백 제거), 없으면 null', () => {
    process.env.METRICS_ACCESS_TOKEN = '  tok  ';
    expect(metricsConfig()).toEqual({ accessToken: 'tok' });
    delete process.env.METRICS_ACCESS_TOKEN;
    expect(metricsConfig()).toEqual({ accessToken: null });
  });

  it('반증: production에서 토큰이 없으면 부팅에서 던진다 — /metrics를 공개 인터넷에 열어 두지 않게', () => {
    process.env.NODE_ENV = 'production';
    expect(() => metricsConfig()).toThrow('METRICS_ACCESS_TOKEN');
    process.env.METRICS_ACCESS_TOKEN = 'tok';
    expect(metricsConfig()).toEqual({ accessToken: 'tok' });
  });
});
