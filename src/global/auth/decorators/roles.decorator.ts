import { SetMetadata } from '@nestjs/common';

import type { AccountRole } from '@/global/auth/types/jwt-payload.type';

export const ROLES_METADATA_KEY = 'auth:roles';

/**
 * 핸들러/클래스가 허용하는 계정 타입을 선언한다. RolesGuard가 읽는다.
 * 메서드 선언이 클래스 선언을 덮어쓴다(getAllAndOverride) — 한 리졸버 클래스에
 * 구매자·판매자 핸들러가 섞인 경우(subscription) 메서드 단위로 좁힌다.
 */
export const Roles = (
  ...roles: AccountRole[]
): ReturnType<typeof SetMetadata> => SetMetadata(ROLES_METADATA_KEY, roles);
