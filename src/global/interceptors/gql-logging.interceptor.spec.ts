import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';

import { GqlLoggingInterceptor } from '@/global/interceptors/gql-logging.interceptor';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { MetricsService } from '@/global/metrics/metrics.service';

jest.mock('@/global/logger/logger', () => ({
  customLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  },
}));

function mockGqlContext(parentType: string): ExecutionContext {
  const args = [
    {},
    {},
    {
      req: {
        headers: {},
        method: 'POST',
        path: '/graphql',
        originalUrl: '/graphql',
        query: {},
        socket: { remoteAddress: '127.0.0.1' },
      },
      res: { headersSent: false, setHeader: jest.fn() },
    },
    {
      fieldName: 'testQuery',
      parentType: { toString: () => parentType },
      operation: { name: { value: 'TestOperation' } },
      path: { key: 'testQuery' },
    },
  ];
  return {
    getType: () => 'graphql',
    switchToHttp: () => ({ getRequest: () => ({}) }),
    getClass: () => Object,
    getHandler: () => jest.fn(),
    getArgs: () => args,
    getArgByIndex: (index: number) => args[index],
    switchToRpc: () => ({}),
    switchToWs: () => ({}),
  } as unknown as ExecutionContext;
}

function mockHandler(data: unknown): CallHandler {
  return { handle: () => of(data) } as CallHandler;
}

function mockErrorHandler(err: Error): CallHandler {
  return { handle: () => throwError(() => err) } as CallHandler;
}

describe('GqlLoggingInterceptor', () => {
  let interceptor: GqlLoggingInterceptor;
  let metrics: MetricsService;
  let logger: CustomLoggerService;

  beforeEach(() => {
    logger = new CustomLoggerService();
    logger.tx = jest.fn();
    logger.txError = jest.fn();
    metrics = new MetricsService();
    interceptor = new GqlLoggingInterceptor(logger, metrics);
  });

  it('graphql이 아니면 그대로 통과시킨다', (done) => {
    const ctx = {
      getType: () => 'http',
    } as unknown as ExecutionContext;
    interceptor.intercept(ctx, mockHandler('pass')).subscribe((v) => {
      expect(v).toBe('pass');
      done();
    });
  });

  it('Query 루트이면 tx 로그에 requestId, request 메타가 포함된다', (done) => {
    const ctx = mockGqlContext('Query');
    interceptor.intercept(ctx, mockHandler({ data: 1 })).subscribe(() => {
      expect(logger.tx).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: expect.any(String),
          request: expect.objectContaining({
            fieldName: 'testQuery',
            parentType: 'Query',
          }),
          processingTimeInMs: expect.any(Number),
          context: 'GraphQL',
        }),
      );
      done();
    });
  });

  it('Mutation 루트이면 tx 로그를 남긴다', (done) => {
    const ctx = mockGqlContext('Mutation');
    interceptor.intercept(ctx, mockHandler({ data: 1 })).subscribe(() => {
      expect(logger.tx).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({ parentType: 'Mutation' }),
        }),
      );
      done();
    });
  });

  it('하위 필드(Query/Mutation 아닌)이면 로깅 없이 통과한다', (done) => {
    const ctx = mockGqlContext('UserProfile');
    interceptor.intercept(ctx, mockHandler({ data: 1 })).subscribe(() => {
      expect(logger.tx).not.toHaveBeenCalled();
      done();
    });
  });

  it('에러 시 txError 는 호출되지 않는다 (GraphQLExceptionFilter 가 담당)', (done) => {
    const ctx = mockGqlContext('Query');
    interceptor.intercept(ctx, mockErrorHandler(new Error('fail'))).subscribe({
      error: () => {
        // 중복 로깅 방지: HTTP path 의 HttpExceptionFilter 와 동일 패턴으로
        // 에러 로깅 owner 는 GraphQLExceptionFilter.
        expect(logger.txError).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('에러 시에도 setResponseTimeHeader 는 호출된다 (응답 시간 추적 유지)', (done) => {
    const ctx = mockGqlContext('Query');
    const args = ctx.getArgs();
    const gqlContext = args[2] as { res: { setHeader: jest.Mock } };
    interceptor.intercept(ctx, mockErrorHandler(new Error('boom'))).subscribe({
      error: () => {
        expect(gqlContext.res.setHeader).toHaveBeenCalledWith(
          'x-response-time-ms',
          expect.any(String),
        );
        done();
      },
    });
  });

  it('성공한 루트 필드를 type·field(스키마 필드명)·outcome=ok로 관측한다 — operationName은 라벨이 아니다', (done) => {
    interceptor
      .intercept(mockGqlContext('Query'), mockHandler('ok'))
      .subscribe({
        complete: () => {
          void metrics.text().then((text) => {
            expect(text).toContain(
              'caquick_graphql_root_field_duration_seconds_count{type="Query",field="testQuery",outcome="ok"} 1',
            );
            expect(text).not.toContain('TestOperation');
            done();
          });
        },
      });
  });

  it('반증: 실패는 인터셉터가 관측하지 않는다 — 가드 거절까지 포함해 GraphQLExceptionFilter가 분류로 센다', (done) => {
    interceptor
      .intercept(mockGqlContext('Mutation'), mockErrorHandler(new Error('x')))
      .subscribe({
        error: () => {
          void metrics.text().then((text) => {
            expect(text).not.toMatch(/type="Mutation",field="testQuery"/);
            done();
          });
        },
      });
  });
});
