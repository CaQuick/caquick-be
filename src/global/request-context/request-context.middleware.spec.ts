import type { NextFunction, Request, Response } from 'express';

import { RequestContextMiddleware } from '@/global/request-context/request-context.middleware';
import { RequestContextService } from '@/global/request-context/request-context.service';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

describe('RequestContextMiddleware', () => {
  let requestContext: RequestContextService;
  let middleware: RequestContextMiddleware;

  beforeEach(() => {
    requestContext = new RequestContextService();
    middleware = new RequestContextMiddleware(requestContext);
  });

  it('next() 콜백 실행 시점에 req.ip/UA 가 컨텍스트에 적재된다', () => {
    const req = mockReq({
      ip: '203.0.113.9',
      headers: { 'user-agent': 'jest-agent' },
    } as Partial<Request>);

    let seenIp: string | undefined;
    let seenUa: string | undefined;
    const next: NextFunction = () => {
      seenIp = requestContext.getClientIp();
      seenUa = requestContext.getUserAgent();
    };

    middleware.use(req, {} as Response, next);

    expect(seenIp).toBe('203.0.113.9');
    expect(seenUa).toBe('jest-agent');
  });

  it('위조된 X-Forwarded-For 가 있어도 req.ip 만 적재한다 (spoofing 방어)', () => {
    const req = mockReq({
      ip: '203.0.113.9',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    } as Partial<Request>);

    let seenIp: string | undefined;
    middleware.use(req, {} as Response, () => {
      seenIp = requestContext.getClientIp();
    });

    expect(seenIp).toBe('203.0.113.9');
  });

  it('async 핸들러(await)를 넘어도 컨텍스트가 유지된다', async () => {
    const req = mockReq({
      ip: '198.51.100.7',
      headers: {},
    } as Partial<Request>);

    let seenIp: string | undefined;
    await new Promise<void>((resolve) => {
      middleware.use(req, {} as Response, () => {
        void (async () => {
          await Promise.resolve();
          seenIp = requestContext.getClientIp();
          resolve();
        })();
      });
    });

    expect(seenIp).toBe('198.51.100.7');
  });

  it('IP/UA 추출 실패 시 undefined 가 적재된다', () => {
    const req = mockReq({ headers: {}, socket: {} } as Partial<Request>);

    let seen: { clientIp?: string; userAgent?: string } | undefined;
    middleware.use(req, {} as Response, () => {
      seen = requestContext.get();
    });

    expect(seen).toEqual({ clientIp: undefined, userAgent: undefined });
  });
});
