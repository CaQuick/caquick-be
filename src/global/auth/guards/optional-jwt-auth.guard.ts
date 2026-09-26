import { Injectable } from '@nestjs/common';

import { JwtAuthGuard } from '@/global/auth/guards/jwt-auth.guard';
import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

/** 토큰이 없거나 검증 실패해도 통과시킨다 — 비로그인 접근을 허용하면서 로그인 시에만 부가 정보(예: isWishlisted)를 채우는 public query용. */
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  override handleRequest<TUser = JwtUser>(
    _err: unknown,
    user: TUser | false | null,
  ): TUser {
    // 비로그인은 req.user가 undefined — IAuthGuard 시그니처(TUser)에 맞추려는 단언
    return (user || undefined) as TUser;
  }
}
