import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';

import type { JwtUser } from '../types/jwt-payload.type';

/**
 * 현재 인증된 사용자 정보를 가져오는 데코레이터
 *
 * - REST: Request.user
 * - GraphQL: Context.req.user
 *
 * @example
 * // REST Controller
 * @Get('me')
 * @UseGuards(JwtAuthGuard)
 * getMe(@CurrentUser() user: JwtUser) {
 *   return user;
 * }
 *
 * @example
 * // GraphQL Resolver
 * @Query(() => User)
 * @UseGuards(JwtAuthGuard)
 * me(@CurrentUser() user: JwtUser) {
 *   return this.userService.findOne(user.accountId);
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): JwtUser | undefined => {
    // GraphQL Context
    const gqlContext = GqlExecutionContext.create(ctx);
    const gqlReq = gqlContext.getContext<{ req?: Request }>()?.req;
    if (gqlReq?.user) {
      return gqlReq.user;
    }

    // HTTP Context
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user;
  },
);
