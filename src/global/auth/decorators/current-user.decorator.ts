import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext, type GqlContextType } from '@nestjs/graphql';
import type { Request } from 'express';

import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

/** createParamDecorator에 전달되는 factory. 테스트에서 직접 호출하기 위해 export. */
export function currentUserFactory(
  _data: unknown,
  ctx: ExecutionContext,
): JwtUser | undefined {
  // GraphQL 요청은 HTTP 경로로 폴백하지 않는다.
  // GraphQL ExecutionContext의 switchToHttp().getRequest()는 HTTP request가 아니라
  // resolver root(args[0])를 반환하므로, 루트 Query에서 비로그인이면
  // undefined.user TypeError(500)가 난다. 컨텍스트 타입으로 분기해 차단한다.
  if (ctx.getType<GqlContextType>() === 'graphql') {
    const gqlReq = GqlExecutionContext.create(ctx).getContext<{
      req?: Request;
    }>()?.req;
    return gqlReq?.user;
  }

  return ctx.switchToHttp().getRequest<Request>().user;
}

export const CurrentUser = createParamDecorator(currentUserFactory);
