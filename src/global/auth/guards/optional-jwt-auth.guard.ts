import { Injectable } from '@nestjs/common';

import { JwtAuthGuard } from '@/global/auth/guards/jwt-auth.guard';
import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

/**
 * 옵셔널 JWT 가드.
 *
 * 토큰이 있으면 인증해 req.user를 채우고, 없거나 검증 실패해도 요청을 통과시킨다.
 * 비로그인 접근을 허용하면서 로그인 시에만 부가 정보(예: isWishlisted)를 채우는
 * public query에 사용한다.
 */
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  override handleRequest<TUser = JwtUser>(
    _err: unknown,
    user: TUser | false | null,
  ): TUser | undefined {
    return user || undefined;
  }
}
