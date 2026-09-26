import { Inject, Injectable } from '@nestjs/common';
import type { RedisPubSub } from 'graphql-redis-subscriptions';

import {
  HEALTH_CHECK_TIMEOUT_MS,
  type HealthIndicator,
} from '@/common/ports/health-indicator.port';
import { withTimeout } from '@/common/utils/with-timeout';
import { PUB_SUB } from '@/global/pubsub/pubsub.constants';

/** PubSub의 publisher 커넥션으로 PING — 별도 커넥션을 열지 않는다(subscriber는 SUBSCRIBE 중이라 일반 명령 불가). */
@Injectable()
export class RedisHealthIndicator implements HealthIndicator {
  readonly name = 'redis';

  constructor(@Inject(PUB_SUB) private readonly pubSub: RedisPubSub) {}

  async check(): Promise<void> {
    await withTimeout(
      this.pubSub.getPublisher().ping(),
      HEALTH_CHECK_TIMEOUT_MS,
      'redis ping',
    );
  }
}
