import { registerAs } from '@nestjs/config';

import { parseEnvString } from '@/common/utils/env-parse';

export interface RedisConfig {
  url: string;
}

/**
 * Redis는 subscription PubSub에 더해 인증 블랙리스트(P2 E2·E3)를 들고 있어 선택이 아니다 —
 * 미설정이면 어느 환경에서든 부팅에서 드러낸다(localhost 폴백은 배포에서 조용히 빈 Redis를 가리켰다).
 */
export function readRedisConfig(
  env: NodeJS.ProcessEnv = process.env,
): RedisConfig {
  const url = parseEnvString(env.REDIS_URL);
  if (!url) {
    throw new Error('REDIS_URL must be set (redis://host:port)');
  }
  return { url };
}

export default registerAs('redis', (): RedisConfig => readRedisConfig());
