import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Redis from 'ioredis';

const STATE_FILE = join(process.cwd(), '.tmp', 'test-db-state.json');

/** globalSetup이 띄운 Redis 컨테이너 주소. env가 없으면(워커 분리 등) state 파일에서 읽는다. */
export function getTestRedisUrl(): string {
  if (process.env.TEST_REDIS_URL) return process.env.TEST_REDIS_URL;
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as {
    redisUrl: string;
  };
  return state.redisUrl;
}

/** spec 전용 클라이언트 — 연결이 끝난 뒤 돌려준다. 워커마다 키 접두를 나누지 않으므로 spec은 beforeEach에서 flushdb로 격리한다. */
export async function connectTestRedis(
  url: string = getTestRedisUrl(),
): Promise<Redis> {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  await client.connect();
  return client;
}
