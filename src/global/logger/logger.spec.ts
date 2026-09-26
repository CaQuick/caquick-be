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

  it('반증: production에서 APP_ROLE이 잘못돼도 모듈 로드는 던지지 않는다 — 검증은 bootstrap 안(resolveAppRole)에서', () => {
    const original = process.env.APP_ROLE;
    process.env.APP_ROLE = 'bogus';
    try {
      withNodeEnv('production', () => {
        jest.resetModules();
        expect(() => loadLogger()).not.toThrow();
      });
    } finally {
      if (original === undefined) delete process.env.APP_ROLE;
      else process.env.APP_ROLE = original;
    }
  });
});

// 운영 출력 계약: 한 줄 JSON + role + ALS의 requestId·eventId — Alloy·Loki가 줄 단위로 읽고 api↔worker를 잇는 열쇠
describe('production 출력 (한 줄 JSON·role·requestId·eventId)', () => {
  const env: Record<string, string | undefined> = {};
  const MESSAGE = Symbol.for('message');

  beforeEach(() => {
    for (const key of ['NODE_ENV', 'APP_ROLE']) env[key] = process.env[key];
    process.env.NODE_ENV = 'production';
    process.env.APP_ROLE = 'worker';
    jest.resetModules();
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.resetModules();
  });

  /** Console transport가 stdout에 쓰는 문자열(info[MESSAGE]) — 전송만 막고 포맷 결과를 모은다 */
  function loadFresh() {
    const { customLogger } = require('@/global/logger/logger') as {
      customLogger: {
        info: (message: string) => void;
        transports: Array<{
          log: (info: Record<symbol, unknown>, next: () => void) => void;
        }>;
      };
    };
    const { requestContextStorage } =
      require('@/global/request-context/request-context.service') as {
        requestContextStorage: {
          run: (store: object, fn: () => void) => void;
        };
      };
    const lines: string[] = [];
    customLogger.transports[0].log = (info, next) => {
      lines.push(String(info[MESSAGE]));
      next();
    };
    return { customLogger, requestContextStorage, lines };
  }

  it('요청 컨텍스트 안의 줄은 requestId·eventId를 싣고, 밖의 줄은 싣지 않는다 — 전부 한 줄 JSON + role', () => {
    const { customLogger, requestContextStorage, lines } = loadFresh();

    requestContextStorage.run({ requestId: 'r1', eventId: 'e1' }, () =>
      customLogger.info('안'),
    );
    customLogger.info('밖');

    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).not.toContain('\n');
    const [inside, outside] = lines.map(
      (l) => JSON.parse(l) as Record<string, unknown>,
    );
    expect(inside).toMatchObject({
      level: 'info',
      message: '안',
      role: 'worker',
      requestId: 'r1',
      eventId: 'e1',
    });
    expect(outside).toMatchObject({
      level: 'info',
      message: '밖',
      role: 'worker',
    });
    expect(outside).not.toHaveProperty('requestId');
    expect(outside).not.toHaveProperty('eventId');
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

  it('message가 non-string(객체)이면 message를 보존하여 meta와 함께 직렬화한다', () => {
    const line = formatDevLogLine({
      level: 'info',
      message: { eventType: 'LOGIN', userId: 7 },
      timestamp: '2026-04-22 10:00:00',
    });
    // structured log 메시지가 사라지지 않도록 message 키로 보존된다.
    expect(line).toBe(
      '2026-04-22 10:00:00 info: {"message":{"eventType":"LOGIN","userId":7}}',
    );
  });

  it('non-string message + meta 동시에 있으면 둘 다 직렬화된다', () => {
    const line = formatDevLogLine({
      level: 'warn',
      message: { code: 'E1' },
      timestamp: '2026-04-22 10:00:00',
      requestId: 'req-1',
    });
    expect(line).toBe(
      '2026-04-22 10:00:00 warn: {"message":{"code":"E1"},"requestId":"req-1"}',
    );
  });

  it('bigint meta가 포함되어도 throw 없이 문자열로 직렬화된다', () => {
    const line = formatDevLogLine({
      level: 'info',
      message: 'with bigint',
      timestamp: '2026-04-22 10:00:00',
      // Number.MAX_SAFE_INTEGER 초과 값은 number로 표현 못 하므로 bigint literal로 정확히 전달
      accountId: 9007199254740993n,
    });
    expect(line).toBe(
      '2026-04-22 10:00:00 info: with bigint {"accountId":"9007199254740993"}',
    );
  });

  it('timestamp 누락 시 현재 시각 ISO 문자열로 fallback (fake timer로 결정성 확보)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-22T10:00:00.000Z'));
    try {
      const line = formatDevLogLine({
        level: 'debug',
        message: 'no ts',
      });
      expect(line).toBe('2026-04-22T10:00:00.000Z debug: no ts');
    } finally {
      jest.useRealTimers();
    }
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
