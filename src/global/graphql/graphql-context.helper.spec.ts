import type { IncomingMessage } from 'node:http';

import type { Request, Response } from 'express';

import { buildGraphqlContext } from '@/global/graphql/graphql-context.helper';

describe('buildGraphqlContext', () => {
  it('HTTP 요청은 req/res를 그대로 전달한다', () => {
    const req = { headers: {} } as Request;
    const res = {} as Response;

    expect(buildGraphqlContext({ req, res })).toEqual({ req, res });
  });

  it('ws 연결은 connectionParams.authorization을 헤더로 이식한다', () => {
    const request = { headers: { host: 'localhost' } } as IncomingMessage;

    const ctx = buildGraphqlContext({
      extra: { request },
      connectionParams: { authorization: 'Bearer token-123' },
    });

    expect(ctx.req).toBe(request);
    expect(request.headers.authorization).toBe('Bearer token-123');
    expect(request.headers.host).toBe('localhost');
  });

  it('authorization이 없거나 문자열이 아니면 헤더를 건드리지 않는다', () => {
    const request = { headers: {} } as IncomingMessage;

    buildGraphqlContext({
      extra: { request },
      connectionParams: { authorization: 123 },
    });
    buildGraphqlContext({ extra: { request } });

    expect(request.headers.authorization).toBeUndefined();
  });
});
