import {
  Global,
  Inject,
  Logger,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import type { RedisConfig } from '@/config/redis.config';
import { REDIS_CLIENT } from '@/global/redis/redis.constants';

const logger = new Logger('RedisModule');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const client = new Redis(config.getOrThrow<RedisConfig>('redis').url, {
          // 부팅은 막지 않고 재시도만 한다. 연결 전·짧은 끊김의 명령은 잠깐 대기(오프라인 큐)하되
          // 재시도 1회·명령 1초 상한으로 빨리 실패시켜 호출자가 폴백(인증은 DB 재조회)으로 넘어가게 한다.
          retryStrategy: (times: number) => Math.min(times * 500, 5_000),
          maxRetriesPerRequest: 1,
          enableOfflineQueue: true,
          commandTimeout: 1_000,
        });
        // 리스너가 없으면 ioredis가 재접속 실패마다 스택을 console.error로 찍는다(구조화 로거 우회). 폴백·헬스가 상태를 드러내므로 한 줄로
        client.on('error', (error: Error) =>
          logger.warn(`Redis 연결 오류: ${error.message}`),
        );
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
