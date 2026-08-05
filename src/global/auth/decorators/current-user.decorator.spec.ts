import type { ExecutionContext } from '@nestjs/common';

import { currentUserFactory } from '@/global/auth/decorators/current-user.decorator';

/**
 * 실제 ExecutionContextHost 동작에 충실한 mock을 만든다.
 * 핵심: switchToHttp().getRequest()는 컨텍스트 타입과 무관하게 args[0]을 반환한다.
 * (GraphQL 컨텍스트에서 args[0]은 resolver root — 루트 Query면 undefined)
 * 과거 mock이 getRequest()를 항상 객체로 반환해 비로그인 GraphQL 500 버그를 놓쳤다.
 */
function makeExecutionContext(args: {
  type: 'graphql' | 'http';
  args: unknown[];
}): ExecutionContext {
  return {
    getType: () => args.type,
    getArgs: () => args.args,
    getArgByIndex: (idx: number) => args.args[idx],
    switchToHttp: () => ({
      getRequest: () => args.args[0],
      getResponse: () => args.args[1],
      getNext: () => args.args[2],
    }),
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

/** GraphQL resolver args: (root, args, context, info). 루트 Query의 root는 undefined. */
function makeGqlContext(reqUser?: unknown): ExecutionContext {
  return makeExecutionContext({
    type: 'graphql',
    args: [undefined, {}, { req: { user: reqUser } }, {}],
  });
}

/** REST handler args: (req, res, next). */
function makeHttpContext(reqUser?: unknown): ExecutionContext {
  return makeExecutionContext({
    type: 'http',
    args: [{ user: reqUser }, {}, () => undefined],
  });
}

describe('currentUserFactory', () => {
  it('GraphQL context에 req.user가 있으면 그 값을 반환한다', () => {
    const user = { accountId: '42' };
    const result = currentUserFactory(undefined, makeGqlContext(user));
    expect(result).toEqual(user);
  });

  it('GraphQL 비로그인(req.user 없음)이면 크래시 없이 undefined를 반환한다', () => {
    // 회귀 케이스: 과거에는 HTTP 폴백으로 내려가 args[0](undefined).user에서
    // TypeError가 발생, OptionalJwtAuthGuard public query가 전부 500이었다.
    const result = currentUserFactory(undefined, makeGqlContext(undefined));
    expect(result).toBeUndefined();
  });

  it('HTTP context면 request.user를 반환한다', () => {
    const user = { accountId: '100' };
    const result = currentUserFactory(undefined, makeHttpContext(user));
    expect(result).toEqual(user);
  });

  it('HTTP context에 user가 없으면 undefined를 반환한다', () => {
    const result = currentUserFactory(undefined, makeHttpContext(undefined));
    expect(result).toBeUndefined();
  });
});
