import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';

const STATE_FILE = join(process.cwd(), '.tmp', 'test-db-state.json');

/**
 * Jest globalSetup.
 *
 * 1) MySQL 8 Testcontainer를 1회 기동
 * 2) DB 접속 정보를 state 파일과 env 변수에 기록
 * 3) worker들이 state 파일로부터 접속 정보를 읽어 worker별 DB를 구성
 */
export default async function globalSetup(): Promise<void> {
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

  const state = {
    containerId: container.getId(),
    host,
    port,
    rootUser,
    rootPassword,
  };

  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');

  process.env.TEST_DB_HOST = host;
  process.env.TEST_DB_PORT = String(port);
  process.env.TEST_DB_ROOT_USER = rootUser;
  process.env.TEST_DB_ROOT_PASSWORD = rootPassword;

  (
    globalThis as unknown as { __TESTCONTAINER__?: StartedTestContainer }
  ).__TESTCONTAINER__ = container;

  console.log(`[test] MySQL container ready at ${host}:${port}`);
}
