import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
 * schemaApplied 플래그는 파일 시스템에 저장한다.
 * Jest는 test file마다 독립된 VM context를 만들므로 module-scope 변수나 globalThis도
 * 공유되지 않는다 → 매 suite마다 ensureSchema()가 재호출되며 mysql admin 연결이
 * 반복 오픈되어 CI flaky 연결에서 "Connection lost"가 발생한다 (PR 7 CI).
 * 파일 시스템은 VM sandboxing과 무관하게 유지되므로 marker file로 해결한다.
 * worker별 DB가 다르므로 파일 경쟁 조건은 없다 (globalTeardown에서 정리).
 */
function getSchemaMarkerPath(dbName: string): string {
  return join(process.cwd(), '.tmp', `schema-applied-${dbName}.marker`);
}

function isSchemaApplied(dbName: string): boolean {
  return existsSync(getSchemaMarkerPath(dbName));
}

function markSchemaApplied(dbName: string): void {
  writeFileSync(getSchemaMarkerPath(dbName), 'ok', 'utf8');
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
