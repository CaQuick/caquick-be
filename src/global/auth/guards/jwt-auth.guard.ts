import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

/**
 * REST/GraphQL 공용 JWT 인증 가드
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * Passport가 토큰을 추출할 Request를 반환한다.
   *
   * - GraphQL: context.req
   * - REST: http request
   *
   * @param context ExecutionContext
   */
  override getRequest(context: ExecutionContext): Request {
    if (context.getType<'http' | 'graphql'>() === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(context);
      return gqlCtx.getContext<{ req: Request }>().req;
    }
    return context.switchToHttp().getRequest<Request>();
  }
}
