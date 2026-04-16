import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';

import { ApiResponseInterceptor } from '@/global/interceptors/api-response.interceptor';
import { ApiResponseTemplate } from '@/global/types/response';

function mockContext(type: string, path: string): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => ({ path }),
    }),
  } as unknown as ExecutionContext;
}

function mockHandler(data: unknown): CallHandler {
  return { handle: () => of(data) } as CallHandler;
}

describe('ApiResponseInterceptor', () => {
  const interceptor = new ApiResponseInterceptor();

  it('http가 아니면 데이터를 그대로 통과시킨다', (done) => {
    const ctx = mockContext('graphql', '/graphql');
    interceptor.intercept(ctx, mockHandler({ raw: true })).subscribe((v) => {
      expect(v).toEqual({ raw: true });
      done();
    });
  });

  it('데이터가 있으면 SUCCESS_WITH_DATA로 래핑한다', (done) => {
    const ctx = mockContext('http', '/api/test');
    interceptor.intercept(ctx, mockHandler({ id: 1 })).subscribe((v) => {
      expect(v).toBeInstanceOf(ApiResponseTemplate);
      expect((v as ApiResponseTemplate<unknown>).data).toEqual({ id: 1 });
      expect((v as ApiResponseTemplate<unknown>).message).toBe('success');
      done();
    });
  });

  it('데이터가 undefined이면 SUCCESS()로 래핑한다', (done) => {
    const ctx = mockContext('http', '/api/test');
    interceptor.intercept(ctx, mockHandler(undefined)).subscribe((v) => {
      expect(v).toBeInstanceOf(ApiResponseTemplate);
      expect((v as ApiResponseTemplate<unknown>).data).toBeNull();
      done();
    });
  });

  it('이미 ApiResponseTemplate이면 그대로 반환한다', (done) => {
    const ctx = mockContext('http', '/api/test');
    const template = ApiResponseTemplate.SUCCESS();
    interceptor.intercept(ctx, mockHandler(template)).subscribe((v) => {
      expect(v).toBe(template);
      done();
    });
  });

  it('excludePaths에 포함된 경로면 데이터를 그대로 반환한다', (done) => {
    const filtered = new ApiResponseInterceptor(new Set(['/health']));
    const ctx = mockContext('http', '/health');
    filtered.intercept(ctx, mockHandler('ok')).subscribe((v) => {
      expect(v).toBe('ok');
      done();
    });
  });
});
