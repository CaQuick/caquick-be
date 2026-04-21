import { formatDevLogLine } from '@/global/logger/logger';

describe('customLogger 초기화 (NODE_ENV 분기)', () => {
  afterEach(() => {
    jest.resetModules();
  });

  function loadLogger() {
    return require('@/global/logger/logger').customLogger as { level: string };
  }

  function withNodeEnv<T>(value: string | undefined, fn: () => T): T {
    const original = process.env.NODE_ENV;
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    try {
      return fn();
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  }

  it('dev 환경(NODE_ENV !== production)에서는 level=debug', () => {
    withNodeEnv('development', () => {
      jest.resetModules();
      expect(loadLogger().level).toBe('debug');
    });
  });

  it('production 환경에서는 level=info', () => {
    withNodeEnv('production', () => {
      jest.resetModules();
      expect(loadLogger().level).toBe('info');
    });
  });
});

describe('formatDevLogLine (printf 콜백)', () => {
  it('string message + meta → "{ts} {level}: {message} {meta-json}" 형식', () => {
    const line = formatDevLogLine({
      level: 'info',
      message: 'hello',
      timestamp: '2026-04-22 10:00:00',
      foo: 'bar',
      count: 1,
    });
    expect(line).toBe(
      '2026-04-22 10:00:00 info: hello {"foo":"bar","count":1}',
    );
  });

  it('string message 단독(meta 없음) → 뒤에 meta JSON을 붙이지 않는다', () => {
    const line = formatDevLogLine({
      level: 'warn',
      message: 'single message',
      timestamp: '2026-04-22 10:00:00',
    });
    expect(line).toBe('2026-04-22 10:00:00 warn: single message');
  });

  it('message가 non-string(객체)이면 meta 전체를 JSON.stringify로 직렬화한다', () => {
    const line = formatDevLogLine({
      level: 'info',
      message: { eventType: 'LOGIN', userId: 7 } as never,
      timestamp: '2026-04-22 10:00:00',
    });
    // message가 non-string이므로 meta 자체가 출력 대상 (message는 rest에 포함 안됨)
    expect(line).toBe('2026-04-22 10:00:00 info: {}');
  });

  it('timestamp 누락 시 현재 시각 ISO 문자열로 fallback', () => {
    const line = formatDevLogLine({
      level: 'debug',
      message: 'no ts',
    });
    // ISO 8601 패턴 (yyyy-mm-ddThh:mm:ss.sssZ)
    expect(line).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z debug: no ts$/,
    );
  });

  it('error level + meta (stack 포함)도 형식에 맞게 문자열화', () => {
    const line = formatDevLogLine({
      level: 'error',
      message: 'failed',
      timestamp: '2026-04-22 10:00:00',
      err: 'boom',
    });
    expect(line).toBe('2026-04-22 10:00:00 error: failed {"err":"boom"}');
  });
});
