import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';

import { GqlLoggingInterceptor } from '@/global/interceptors/gql-logging.interceptor';
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
  let logger: CustomLoggerService;

  beforeEach(() => {
    logger = new CustomLoggerService();
    logger.tx = jest.fn();
    logger.txError = jest.fn();
    interceptor = new GqlLoggingInterceptor(logger);
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

  it('Query 루트이면 tx 로그를 남긴다', (done) => {
    const ctx = mockGqlContext('Query');
    interceptor.intercept(ctx, mockHandler({ data: 1 })).subscribe(() => {
      expect(logger.tx).toHaveBeenCalled();
      done();
    });
  });

  it('Mutation 루트이면 tx 로그를 남긴다', (done) => {
    const ctx = mockGqlContext('Mutation');
    interceptor.intercept(ctx, mockHandler({ data: 1 })).subscribe(() => {
      expect(logger.tx).toHaveBeenCalled();
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

  it('에러 시 txError 로그를 남긴다', (done) => {
    const ctx = mockGqlContext('Query');
    interceptor.intercept(ctx, mockErrorHandler(new Error('fail'))).subscribe({
      error: () => {
        expect(logger.txError).toHaveBeenCalled();
        done();
      },
    });
  });
});
