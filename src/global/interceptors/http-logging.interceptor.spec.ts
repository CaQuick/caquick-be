import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';

import { HttpLoggingInterceptor } from '@/global/interceptors/http-logging.interceptor';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { LogContext } from '@/global/types/log.type';

jest.mock('@/global/logger/logger', () => ({
  customLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  },
}));

function mockHttpContext(statusCode = 200): {
  ctx: ExecutionContext;
  resSetHeader: jest.Mock;
} {
  const resSetHeader = jest.fn();
  const ctx = {
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
        statusCode,
        headersSent: false,
        setHeader: resSetHeader,
      }),
    }),
  } as unknown as ExecutionContext;
  return { ctx, resSetHeader };
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
    const ctx = { getType: () => 'graphql' } as unknown as ExecutionContext;
    interceptor.intercept(ctx, mockHandler('pass')).subscribe((v) => {
      expect(v).toBe('pass');
      expect(logger.tx).not.toHaveBeenCalled();
      done();
    });
  });

  it('http 요청이면 tx 로그를 남긴다', (done) => {
    const { ctx } = mockHttpContext();
    interceptor.intercept(ctx, mockHandler({ ok: true })).subscribe(() => {
      expect(logger.tx).toHaveBeenCalledWith(
        expect.objectContaining({
          context: LogContext.REST,
          response: expect.objectContaining({ statusCode: 200 }),
        }),
      );
      done();
    });
  });

  it('로그 페이로드에 requestId와 request 메타가 포함된다', (done) => {
    const { ctx } = mockHttpContext();
    interceptor.intercept(ctx, mockHandler(null)).subscribe(() => {
      expect(logger.tx).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: expect.any(String),
          request: expect.objectContaining({
            method: 'GET',
            path: '/api/test',
          }),
        }),
      );
      done();
    });
  });

  it('응답 헤더에 x-response-time-ms가 설정된다', (done) => {
    const { ctx, resSetHeader } = mockHttpContext();
    interceptor.intercept(ctx, mockHandler(null)).subscribe(() => {
      expect(resSetHeader).toHaveBeenCalledWith(
        'x-response-time-ms',
        expect.any(String),
      );
      done();
    });
  });

  it('비정상 상태코드도 정상적으로 로깅한다', (done) => {
    const { ctx } = mockHttpContext(500);
    interceptor.intercept(ctx, mockHandler(null)).subscribe(() => {
      expect(logger.tx).toHaveBeenCalledWith(
        expect.objectContaining({
          response: expect.objectContaining({ statusCode: 500 }),
        }),
      );
      done();
    });
  });

  it('statusCode가 falsy(0)이면 HttpStatus.OK(200)로 fallback', (done) => {
    const { ctx } = mockHttpContext(0);
    interceptor.intercept(ctx, mockHandler(null)).subscribe(() => {
      expect(logger.tx).toHaveBeenCalledWith(
        expect.objectContaining({
          response: expect.objectContaining({ statusCode: 200 }),
        }),
      );
      done();
    });
  });
});
