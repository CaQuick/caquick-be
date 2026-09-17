import type { ExecutionContext } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { JwtAuthGuard } from '@/global/auth/guards/jwt-auth.guard';
import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard();

  describe('handleRequest', () => {
    const user: JwtUser = { accountId: '1', accountType: 'USER' };
    const named = (name: string) => Object.assign(new Error(name), { name });

    it('user가 있으면 그대로 반환한다', () => {
      expect(guard.handleRequest(null, user)).toBe(user);
    });

    it('전략이 던진 예외(err)는 그대로 전파한다', () => {
      const err = new DomainException('ACCOUNT_NOT_ACTIVE');
      expect(() => guard.handleRequest(err, null)).toThrow(err);
    });

    // Passport 기본 UnauthorizedException('Unauthorized') 대신 카탈로그 코드 — info 종류 전수
    it.each([
      ['TokenExpiredError', named('TokenExpiredError'), 'INVALID_ACCESS_TOKEN'],
      ['JsonWebTokenError', named('JsonWebTokenError'), 'INVALID_ACCESS_TOKEN'],
      ['NotBeforeError', named('NotBeforeError'), 'INVALID_ACCESS_TOKEN'],
      ['No auth token', new Error('No auth token'), 'AUTHENTICATION_REQUIRED'],
      ['info 없음', undefined, 'AUTHENTICATION_REQUIRED'],
      ['Error가 아닌 info', 'string', 'AUTHENTICATION_REQUIRED'],
    ])('user 없음 + info=%s → %s', (_label, info, code) => {
      expect(() => guard.handleRequest(null, false, info)).toThrowDomain(code);
    });
  });

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
