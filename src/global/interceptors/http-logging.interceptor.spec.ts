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

function mockHttpContext(
  statusCode = 200,
  path = '/api/test',
): {
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
        path,
        originalUrl: path,
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

  // compose·Prometheus 프로브는 몇 초마다 온다 — 줄마다 Loki에 실리면 상시 소음
  it.each([
    '/health',
    '/health/ready',
    '/health/live',
    '/metrics',
    '/METRICS/',
  ])(
    '프로브 경로 %s는 tx 로그를 남기지 않지만 응답 시간 헤더는 붙인다',
    async (path) => {
      const { ctx, resSetHeader } = mockHttpContext(200, path);
      await new Promise<void>((resolve) => {
        interceptor.intercept(ctx, mockHandler({})).subscribe(() => resolve());
      });
      expect(logger.tx).not.toHaveBeenCalled();
      expect(resSetHeader).toHaveBeenCalledWith(
        'x-response-time-ms',
        expect.any(String),
      );
    },
  );

  it('반증: 프로브라도 실패 응답(503)은 tx 로그를 남긴다 — 무엇이 죽었는지 봐야 한다', (done) => {
    const { ctx } = mockHttpContext(503, '/health/ready');
    interceptor.intercept(ctx, mockHandler({})).subscribe(() => {
      expect(logger.tx).toHaveBeenCalledWith(
        expect.objectContaining({ response: { statusCode: 503 } }),
      );
      done();
    });
  });

  it('반증: /healthz 같은 유사 경로는 프로브가 아니라 로그를 남긴다', (done) => {
    const { ctx } = mockHttpContext(200, '/healthz');
    interceptor.intercept(ctx, mockHandler({})).subscribe(() => {
      expect(logger.tx).toHaveBeenCalled();
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
