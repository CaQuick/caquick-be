import { Global, Module, type OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import Redis, { type RedisOptions } from 'ioredis';

import type { RedisConfig } from '@/config/redis.config';
import { PUB_SUB } from '@/global/pubsub/pubsub.constants';

/**
 * GraphQL subscription용 Redis PubSub 전역 모듈.
 * 수평 확장(다중 인스턴스) 시에도 이벤트가 모든 인스턴스에 전파되도록
 * 처음부터 Redis 백엔드를 쓴다(사용자 확정). publisher/subscriber는
 * Redis 프로토콜 제약(SUBSCRIBE 중 일반 명령 불가) 때문에 커넥션을 분리한다.
 */
@Global()
@Module({
  providers: [
    {
      provide: PUB_SUB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RedisPubSub => {
        const redisConfig = config.getOrThrow<RedisConfig>('redis');
        const options: RedisOptions = {
          // Redis 미기동 시 부팅을 막지 않고 재시도만 한다(로컬 DX)
          retryStrategy: (times: number) => Math.min(times * 500, 5000),
          maxRetriesPerRequest: null,
        };
        return new RedisPubSub({
          publisher: new Redis(redisConfig.url, options),
          subscriber: new Redis(redisConfig.url, options),
        });
      },
    },
  ],
  exports: [PUB_SUB],
})
export class PubSubModule implements OnModuleDestroy {
  constructor(@Inject(PUB_SUB) private readonly pubSub: RedisPubSub) {}

  async onModuleDestroy(): Promise<void> {
    await this.pubSub.close();
  }
}
