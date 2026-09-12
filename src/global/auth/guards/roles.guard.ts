import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  ACCOUNT_TYPE_NOT_ALLOWED,
  AUTHENTICATION_REQUIRED,
} from '@/global/auth/constants/auth-error-messages';
import { ROLES_METADATA_KEY } from '@/global/auth/decorators/roles.decorator';
import { requestOfContext } from '@/global/auth/guards/request-of-context.helper';
import type { AccountRole } from '@/global/auth/types/jwt-payload.type';

/**
 * 계정 타입 인가 가드. JwtAuthGuard 뒤에 둔다 — req.user는 JwtBearerStrategy가
 * DB에서 읽은 accountType을 이미 싣고 있어 여기서는 추가 조회가 없다.
 * @Roles 선언이 없는 핸들러는 통과시킨다(인증만 필요한 구매자 API).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<AccountRole[] | undefined>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) return true;

    const user = requestOfContext(context)?.user;
    if (!user) throw new UnauthorizedException(AUTHENTICATION_REQUIRED);
    if (!user.accountType || !roles.includes(user.accountType)) {
      throw new ForbiddenException(ACCOUNT_TYPE_NOT_ALLOWED);
    }
    return true;
  }
}
