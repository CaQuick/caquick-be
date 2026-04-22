import type { ExecutionContext } from '@nestjs/common';

import { currentUserFactory } from '@/global/auth/decorators/current-user.decorator';

function makeExecutionContext(opts: {
  gqlReqUser?: unknown;
  httpReqUser?: unknown;
  gqlContextType?: string;
}): ExecutionContext {
  const gqlReq = opts.gqlReqUser !== undefined ? { user: opts.gqlReqUser } : {};
  const httpReq = { user: opts.httpReqUser };
  // GraphQL resolver args는 (root, args, context, info) 4 요소.
  // GqlExecutionContext.getContext()는 args[2]를 반환한다.
  const gqlArgs = [null, null, { req: gqlReq }, null];

  const ctx = {
    getType: () => opts.gqlContextType ?? 'http',
    getArgs: () => gqlArgs,
    getArgByIndex: (idx: number) => gqlArgs[idx] ?? null,
    switchToHttp: () => ({
      getRequest: () => httpReq,
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  return ctx;
}

describe('currentUserFactory', () => {
  it('GraphQL context에 req.user가 있으면 그 값을 반환한다', () => {
    const user = { accountId: '42' };
    const ctx = makeExecutionContext({
      gqlReqUser: user,
      gqlContextType: 'graphql',
    });

    const result = currentUserFactory(undefined, ctx);
    expect(result).toEqual(user);
  });

  it('GraphQL context에 req.user가 없으면 HTTP request.user로 fallback', () => {
    const user = { accountId: '100' };
    const ctx = makeExecutionContext({
      httpReqUser: user,
      gqlContextType: 'http',
    });

    const result = currentUserFactory(undefined, ctx);
    expect(result).toEqual(user);
  });

  it('어느 곳에도 user가 없으면 undefined 반환', () => {
    const ctx = makeExecutionContext({});
    const result = currentUserFactory(undefined, ctx);
    expect(result).toBeUndefined();
  });
});
