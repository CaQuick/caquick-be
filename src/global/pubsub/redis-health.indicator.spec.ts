import type { RedisPubSub } from 'graphql-redis-subscriptions';

import { RedisHealthIndicator } from '@/global/pubsub/redis-health.indicator';

function indicatorWith(ping: () => Promise<string>): RedisHealthIndicator {
  const pubSub = { getPublisher: () => ({ ping }) } as unknown as RedisPubSub;
  return new RedisHealthIndicator(pubSub);
}

describe('RedisHealthIndicator', () => {
  it('PING이 응답하면 통과한다', async () => {
    await expect(
      indicatorWith(() => Promise.resolve('PONG')).check(),
    ).resolves.toBeUndefined();
  });

  it('반증: 연결 오류는 그대로 실패로 드러난다', async () => {
    await expect(
      indicatorWith(() => Promise.reject(new Error('ECONNREFUSED'))).check(),
    ).rejects.toThrow('ECONNREFUSED');
  });
});
