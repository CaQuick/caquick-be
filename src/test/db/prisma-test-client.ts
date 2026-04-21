import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import mysql from 'mysql2/promise';

import { softDeleteExtension } from '@/prisma/soft-delete.middleware';

const STATE_FILE = join(process.cwd(), '.tmp', 'test-db-state.json');

interface TestDbState {
  host: string;
  port: number;
  rootUser: string;
  rootPassword: string;
}

let cachedClient: PrismaClient | null = null;
let cachedDbUrl: string | null = null;

/**
 * schemaApplied는 worker 프로세스 전역으로 유지한다.
 * Jest는 test file마다 module registry를 새로 만들기 때문에 module-scope 변수로는
 * suite 간 공유되지 않는다. 이 경우 매 suite마다 ensureSchema()가 호출되며
 * `mysql.createConnection`과 `npx prisma migrate deploy`가 반복되는데, CI의
 * MySQL 연결이 flaky하면 "Connection lost" 오류가 발생한다 (PR 7 CI).
 * globalThis에 저장해 한 worker가 살아있는 동안 1회만 실행되도록 한다.
 */
interface TestDbGlobal {
  __TEST_SCHEMA_APPLIED__?: Record<string, boolean>;
}

function isSchemaApplied(dbName: string): boolean {
  const g = globalThis as unknown as TestDbGlobal;
  return g.__TEST_SCHEMA_APPLIED__?.[dbName] === true;
}

function markSchemaApplied(dbName: string): void {
  const g = globalThis as unknown as TestDbGlobal;
  if (!g.__TEST_SCHEMA_APPLIED__) g.__TEST_SCHEMA_APPLIED__ = {};
  g.__TEST_SCHEMA_APPLIED__[dbName] = true;
}

function loadState(): TestDbState {
  const raw = readFileSync(STATE_FILE, 'utf8');
  return JSON.parse(raw) as TestDbState;
}

function buildDbName(): string {
  const workerId = process.env.JEST_WORKER_ID ?? '1';
  return `caquick_test_w${workerId}`;
}

function buildTestDbUrl(state: TestDbState, dbName: string): string {
  return `mysql://${state.rootUser}:${encodeURIComponent(state.rootPassword)}@${state.host}:${state.port}/${dbName}`;
}

/**
 * Worker별 테스트 DB를 준비한다.
 * - worker별 격리된 DB 생성(없으면 CREATE)
 * - `prisma migrate deploy`로 스키마 적용 (worker당 1회)
 */
async function ensureSchema(
  state: TestDbState,
  dbName: string,
  dbUrl: string,
): Promise<void> {
  if (isSchemaApplied(dbName)) return;

  const admin = await mysql.createConnection({
    host: state.host,
    port: state.port,
    user: state.rootUser,
    password: state.rootPassword,
  });
  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await admin.end();
  }

  execSync('npx prisma migrate deploy', {
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
    },
    stdio: 'pipe',
  });

  markSchemaApplied(dbName);
}

/**
 * 테스트용 Prisma 클라이언트를 반환한다.
 * - worker별 전용 DB 사용
 * - softDelete extension 적용 (운영 PrismaService와 동일 동작)
 */
export async function getTestPrismaClient(): Promise<PrismaClient> {
  if (cachedClient) return cachedClient;

  const state = loadState();
  const dbName = buildDbName();
  const dbUrl = buildTestDbUrl(state, dbName);
  cachedDbUrl = dbUrl;

  await ensureSchema(state, dbName, dbUrl);

  const client = new PrismaClient({
    datasources: { db: { url: dbUrl } },
  }).$extends(softDeleteExtension);

  cachedClient = client as unknown as PrismaClient;
  return cachedClient;
}

export function getTestDatabaseUrl(): string {
  if (!cachedDbUrl) {
    throw new Error(
      'Test database URL not initialized. Call getTestPrismaClient() first.',
    );
  }
  return cachedDbUrl;
}

export async function disconnectTestPrismaClient(): Promise<void> {
  if (cachedClient) {
    await cachedClient.$disconnect();
    cachedClient = null;
  }
  // schemaApplied 플래그는 globalThis에 있으므로 건드리지 않는다.
  // worker 프로세스가 살아있는 동안 migrate를 다시 돌리지 않는다.
}
