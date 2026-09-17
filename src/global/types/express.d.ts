import 'express-serve-static-core';

import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;

    startTime?: number;

    user?: JwtUser;
  }
}
