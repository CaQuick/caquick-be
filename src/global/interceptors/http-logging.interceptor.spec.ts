import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';

import { HttpLoggingInterceptor } from '@/global/interceptors/http-logging.interceptor';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';

jest.mock('@/global/logger/logger', () => ({
  customLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  },
}));

function mockHttpContext(): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {},
        method: 'GET',
        path: '/api/test',
        originalUrl: '/api/test',
        query: {},
        socket: { remoteAddress: '127.0.0.1' },
      }),
      getResponse: () => ({
        statusCode: 200,
        headersSent: false,
        setHeader: jest.fn(),
      }),
    }),
  } as unknown as ExecutionContext;
}

function mockHandler(data: unknown): CallHandler {
  return { handle: () => of(data) } as CallHandler;
}

describe('HttpLoggingInterceptor', () => {
  let interceptor: HttpLoggingInterceptor;
  let logger: CustomLoggerService;

  beforeEach(() => {
    logger = new CustomLoggerService();
    logger.tx = jest.fn();
    interceptor = new HttpLoggingInterceptor(logger);
  });

  it('http가 아니면 그대로 통과시킨다', (done) => {
    const ctx = {
      getType: () => 'graphql',
    } as unknown as ExecutionContext;
    interceptor.intercept(ctx, mockHandler('pass')).subscribe((v) => {
      expect(v).toBe('pass');
      done();
    });
  });

  it('http 요청이면 tx 로그를 남긴다', (done) => {
    const ctx = mockHttpContext();
    interceptor.intercept(ctx, mockHandler({ ok: true })).subscribe(() => {
      expect(logger.tx).toHaveBeenCalled();
      done();
    });
  });
});
