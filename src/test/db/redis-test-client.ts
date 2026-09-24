import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Redis from 'ioredis';

const STATE_FILE = join(process.cwd(), '.tmp', 'test-db-state.json');

/**
 * globalSetup이 띄운 Redis 컨테이너 주소 + **워커별 DB 번호**. jest 워커가 병렬로 flushdb하므로 워커마다 논리 DB를
 * 나눠야 서로의 키를 지우지 않는다(Redis 기본 16개 — 워커 수가 그보다 많으면 나머지 연산으로 겹친다).
 */
export function getTestRedisUrl(): string {
  const base = process.env.TEST_REDIS_URL ?? readStateUrl();
  const worker = Number(process.env.JEST_WORKER_ID ?? '1');
  return `${base.replace(/\/\d+$/, '')}/${worker % 16}`;
}

function readStateUrl(): string {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as {
    redisUrl: string;
  };
  return state.redisUrl;
}

/** spec 전용 클라이언트 — 연결이 끝난 뒤 돌려준다. spec은 beforeEach에서 (자기 워커 DB만) flushdb로 격리한다. */
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
