import { type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';

/**
 * 컨텍스트 종류에 맞는 HTTP request를 꺼낸다.
 * GraphQL에서는 switchToHttp().getRequest()가 resolver root(args[0])를 돌려주므로
 * GqlExecutionContext를 거쳐야 한다. 인증·인가 가드가 공유한다.
 */
export function requestOfContext(context: ExecutionContext): Request {
  if (context.getType<'http' | 'graphql'>() === 'graphql') {
    const gqlCtx = GqlExecutionContext.create(context);
    return gqlCtx.getContext<{ req: Request }>().req;
  }
  return context.switchToHttp().getRequest<Request>();
}
