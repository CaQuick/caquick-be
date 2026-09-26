import { registerAs } from '@nestjs/config';

import { parseEnvString } from '@/common/utils/env-parse';

export interface RabbitmqConfig {
  url: string;
}

/** 이벤트 백본. 미설정이면 어느 환경에서든 부팅에서 드러낸다 — 워커가 조용히 이벤트를 안 나르는 상태를 막는다. */
export function readRabbitmqConfig(
  env: NodeJS.ProcessEnv = process.env,
): RabbitmqConfig {
  const url = parseEnvString(env.RABBITMQ_URL);
  if (!url) {
    throw new Error('RABBITMQ_URL must be set (amqp://user:pass@host:5672)');
  }
  return { url };
}

export default registerAs('rabbitmq', (): RabbitmqConfig =>
  readRabbitmqConfig(),
);
