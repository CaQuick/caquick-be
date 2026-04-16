import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import { JwtAuthGuard } from '@/global/auth/guards/jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard();

  it('graphql 컨텍스트이면 GQL context의 req를 반환한다', () => {
    const mockReq = { headers: { authorization: 'Bearer token' } };
    // GqlExecutionContext.create()가 내부적으로 getArgs()[2]를 context로 사용
    const ctx = {
      getType: () => 'graphql' as const,
      getClass: () => Object,
      getHandler: () => jest.fn(),
      getArgs: () => [{}, {}, { req: mockReq }, {}],
      getArgByIndex: (i: number) => [{}, {}, { req: mockReq }, {}][i],
      switchToHttp: () => ({ getRequest: () => ({}) }),
      switchToRpc: () => ({}),
      switchToWs: () => ({}),
    } as unknown as ExecutionContext;

    const result = guard.getRequest(ctx);
    expect(result).toBe(mockReq);
  });

  it('http 컨텍스트이면 HTTP request를 반환한다', () => {
    const mockReq = { headers: { authorization: 'Bearer token' } };
    const ctx = {
      getType: () => 'http' as const,
      switchToHttp: () => ({ getRequest: () => mockReq }),
    } as unknown as ExecutionContext;

    const result = guard.getRequest(ctx);
    expect(result).toBe(mockReq);
  });
});
