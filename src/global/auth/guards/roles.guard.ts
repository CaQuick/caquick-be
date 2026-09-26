import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { DomainException } from '@/common/errors/error-catalog';
import { ROLES_METADATA_KEY } from '@/global/auth/decorators/roles.decorator';
import { requestOfContext } from '@/global/auth/guards/request-of-context.helper';
import type { AccountRole } from '@/global/auth/types/jwt-payload.type';

/**
 * 계정 타입 인가 가드. JwtAuthGuard 뒤에 둔다 — req.user는 JwtBearerStrategy가
 * DB에서 읽은 accountType을 이미 싣고 있어 여기서는 추가 조회가 없다.
 * @Roles 선언이 없는 핸들러는 통과시킨다(인증만 필요한 구매자 API).
 *
 * 초기/초기화 비밀번호 상태(mustChangePassword)도 여기서 막는다 — @Roles가 붙는
 * SELLER/ADMIN API 전부가 대상이고, 비밀번호 변경 REST는 JwtAuthGuard만 걸려 있어 통과한다.
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
    if (!user) throw new DomainException('AUTHENTICATION_REQUIRED');
    if (!user.accountType || !roles.includes(user.accountType)) {
      throw new DomainException('ACCOUNT_TYPE_NOT_ALLOWED');
    }
    if (user.mustChangePassword) {
      throw new DomainException('PASSWORD_CHANGE_REQUIRED');
    }
    return true;
  }
}
