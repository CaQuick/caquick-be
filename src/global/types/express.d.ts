import 'express-serve-static-core';

import type { JwtUser } from '../auth/types/jwt-payload.type';

declare module 'express-serve-static-core' {
  interface Request {
    /**
     * 요청 상관관계 ID
     */
    requestId?: string;

    /**
     * 요청 시작 시간(ms)
     */
    startTime?: number;

    /**
     * JWT 인증된 사용자 정보
     * - JwtCookieStrategy에서 validate 후 주입됨
     */
    user?: JwtUser;
  }
}
