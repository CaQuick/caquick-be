describe('customLogger', () => {
  afterEach(() => {
    jest.resetModules();
  });

  function loadLogger() {
    // 각 테스트마다 logger.ts의 top-level 초기화를 다시 타게 한다
    return require('@/global/logger/logger').customLogger as {
      info: (msg: unknown, meta?: Record<string, unknown>) => void;
      error: (msg: unknown, meta?: Record<string, unknown>) => void;
      level: string;
    };
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
      const logger = loadLogger();
      expect(logger.level).toBe('debug');
    });
  });

  it('production 환경에서는 level=info', () => {
    withNodeEnv('production', () => {
      jest.resetModules();
      const logger = loadLogger();
      expect(logger.level).toBe('info');
    });
  });

  it('dev format: string message + meta 조합을 로깅해도 throw하지 않는다', () => {
    withNodeEnv('development', () => {
      jest.resetModules();
      const logger = loadLogger();
      expect(() =>
        logger.info('hello', { foo: 'bar', count: 1 }),
      ).not.toThrow();
    });
  });

  it('dev format: string message 단독(meta 없음)도 로깅한다', () => {
    withNodeEnv('development', () => {
      jest.resetModules();
      const logger = loadLogger();
      expect(() => logger.info('single message')).not.toThrow();
    });
  });

  it('dev format: message가 non-string(객체)여도 로깅한다', () => {
    withNodeEnv('development', () => {
      jest.resetModules();
      const logger = loadLogger();
      expect(() =>
        logger.info({ eventType: 'LOGIN', userId: 7 } as unknown as string),
      ).not.toThrow();
    });
  });

  it('error level 로깅도 throw하지 않는다 (errors.stack 포맷 경로)', () => {
    withNodeEnv('development', () => {
      jest.resetModules();
      const logger = loadLogger();
      expect(() =>
        logger.error('failed', { err: new Error('boom').message }),
      ).not.toThrow();
    });
  });
});
