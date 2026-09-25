import {
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';

const TMP_DIR = join(process.cwd(), '.tmp');
const STATE_FILE = join(TMP_DIR, 'test-db-state.json');

export default async function globalSetup(): Promise<void> {
  // 이전 실행이 Ctrl+C 등으로 중단되어 globalTeardown이 실행되지 않았다면 .tmp/schema-applied-*.marker가
  // stale 상태로 남는다. 새 MySQL 컨테이너를 기동하는 시점이므로 무조건 정리한다.
  if (existsSync(TMP_DIR)) {
    for (const name of readdirSync(TMP_DIR)) {
      if (name.startsWith('schema-applied-') && name.endsWith('.marker')) {
        unlinkSync(join(TMP_DIR, name));
      }
    }
  }

  console.log('[test] starting MySQL container...');

  const container: StartedTestContainer = await new GenericContainer(
    'mysql:8.0',
  )
    .withExposedPorts(3306)
    .withEnvironment({
      MYSQL_ROOT_PASSWORD: 'test',
      MYSQL_DATABASE: 'caquick_test_root',
    })
    .withCommand([
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_unicode_ci',
    ])
    .withWaitStrategy(Wait.forHealthCheck())
    .withHealthCheck({
      test: [
        'CMD-SHELL',
        'mysqladmin ping -h localhost -u root -ptest || exit 1',
      ],
      interval: 2_000_000_000, // 2s in nanoseconds
      timeout: 5_000_000_000,
      retries: 30,
      startPeriod: 10_000_000_000,
    })
    .withStartupTimeout(120_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(3306);
  const rootUser = 'root';
  const rootPassword = 'test';

  // 인증 블랙리스트는 실제 Redis로 검증한다 — DB와 같은 이유로 mock하지 않는다.
  console.log('[test] starting Redis container...');
  const redis: StartedTestContainer = await new GenericContainer(
    'redis:7-alpine',
  )
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .withStartupTimeout(60_000)
    .start();
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  const state = {
    containerId: container.getId(),
    host,
    port,
    rootUser,
    rootPassword,
    redisContainerId: redis.getId(),
    redisUrl,
  };

  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');

  process.env.TEST_DB_HOST = host;
  process.env.TEST_DB_PORT = String(port);
  process.env.TEST_DB_ROOT_USER = rootUser;
  process.env.TEST_DB_ROOT_PASSWORD = rootPassword;
  process.env.TEST_REDIS_URL = redisUrl;

  (
    globalThis as unknown as {
      __TESTCONTAINER__?: StartedTestContainer;
      __REDIS_TESTCONTAINER__?: StartedTestContainer;
    }
  ).__TESTCONTAINER__ = container;
  (
    globalThis as unknown as { __REDIS_TESTCONTAINER__?: StartedTestContainer }
  ).__REDIS_TESTCONTAINER__ = redis;

  console.log(`[test] MySQL container ready at ${host}:${port}`);
  console.log(`[test] Redis container ready at ${redisUrl}`);
}
