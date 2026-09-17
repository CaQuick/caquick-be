import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

import { DomainException } from '@/common/errors/error-catalog';
import { requestOfContext } from '@/global/auth/guards/request-of-context.helper';
import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

// passport-jwt가 토큰 검증 실패 시 info로 넘기는 jsonwebtoken 오류 이름. 그 외(info 없음·'No auth token')는 토큰 미제출.
const TOKEN_ERROR_NAMES = new Set([
  'TokenExpiredError',
  'JsonWebTokenError',
  'NotBeforeError',
]);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * Passport 기본 `UnauthorizedException('Unauthorized')`를 카탈로그 코드로 바꾼다.
   * 전략(validate)이 던진 DomainException은 err로 오므로 그대로 전파한다.
   */
  override handleRequest<TUser = JwtUser>(
    err: unknown,
    user: TUser | false | null,
    info?: unknown,
  ): TUser {
    if (err instanceof Error) throw err;
    if (!user) {
      const name = info instanceof Error ? info.name : undefined;
      throw new DomainException(
        name !== undefined && TOKEN_ERROR_NAMES.has(name)
          ? 'INVALID_ACCESS_TOKEN'
          : 'AUTHENTICATION_REQUIRED',
      );
    }
    return user;
  }

  override getRequest(context: ExecutionContext): Request {
    return requestOfContext(context);
  }
}
