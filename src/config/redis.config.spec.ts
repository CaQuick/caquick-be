import { readRedisConfig } from '@/config/redis.config';

describe('redisConfig', () => {
  it('REDIS_URL을 읽는다', () => {
    expect(readRedisConfig({ REDIS_URL: ' redis://redis:6379 ' })).toEqual({
      url: 'redis://redis:6379',
    });
  });

  it.each([undefined, '', '   '])(
    '반증: 미설정(%p)이면 폴백 없이 부팅에서 던진다',
    (value) => {
      expect(() => readRedisConfig({ REDIS_URL: value })).toThrow('REDIS_URL');
    },
  );
});
