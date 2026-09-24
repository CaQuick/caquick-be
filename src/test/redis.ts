import type { Provider } from '@nestjs/common';
import type Redis from 'ioredis';

import { TokenBlacklistService } from '@/global/auth/blacklist';
import { REDIS_CLIENT } from '@/global/redis';

/** 실제 Redis 클라이언트를 REDIS_CLIENT 자리에 넣는다(블랙리스트·전략 spec). 닫는 건 spec의 afterAll. */
export function redisTestProviders(client: Redis): Provider[] {
  return [{ provide: REDIS_CLIENT, useValue: client }];
}

/** 블랙리스트를 부르기만 하고 결과를 보지 않는 spec용 대역 — 아무것도 막지 않고 아무것도 기록하지 않는다. */
export const NOOP_BLACKLIST_PROVIDER: Provider = {
  provide: TokenBlacklistService,
  useValue: {
    block: () => Promise.resolve(),
    unblock: () => Promise.resolve(),
    blockedReason: () => Promise.resolve(null),
  },
};
