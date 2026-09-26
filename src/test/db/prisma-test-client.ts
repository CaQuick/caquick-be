import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import mysql from 'mysql2/promise';

import { PrismaClient } from '@/generated/prisma/client';
import { createMariaDbAdapter } from '@/prisma/mariadb-adapter';
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
 * Jest는 test file마다 독립된 VM context를 만들어 module-scope 변수나 globalThis가 공유되지 않는다 → 매 suite마다
 * ensureSchema()가 재호출되며 mysql admin 연결이 반복 오픈되어 CI에서 "Connection lost"가 난다. 파일 시스템은
 * VM sandboxing과 무관하므로 marker file로 해결한다(worker별 DB가 달라 파일 경쟁은 없다).
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
 * Testcontainers의 mysqladmin ping healthcheck가 통과해도 실제 외부 연결을 받을 준비가 안 된 구간이 CI에서
 * 관측됐다("Connection lost: The server closed the connection") — 500ms → 8s 백오프로 최대 5회 재시도.
 */
async function connectAdminWithRetry(
  state: TestDbState,
): Promise<mysql.Connection> {
  const maxAttempts = 5;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await mysql.createConnection({
        host: state.host,
        port: state.port,
        user: state.rootUser,
        password: state.rootPassword,
      });
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) break;
      const backoffMs = 500 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastError;
}

async function ensureSchema(
  state: TestDbState,
  dbName: string,
  dbUrl: string,
): Promise<void> {
  if (isSchemaApplied(dbName)) return;

  const admin = await connectAdminWithRetry(state);
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

export async function getTestPrismaClient(): Promise<PrismaClient> {
  if (cachedClient) return cachedClient;

  const state = loadState();
  const dbName = buildDbName();
  const dbUrl = buildTestDbUrl(state, dbName);
  cachedDbUrl = dbUrl;

  await ensureSchema(state, dbName, dbUrl);

  // 컨테이너 root는 caching_sha2_password라 콜드 연결에 RSA 키 조회 허용이 필요하다
  const client = new PrismaClient({
    adapter: createMariaDbAdapter(dbUrl, { allowPublicKeyRetrieval: true }),
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
  // schema marker는 파일 시스템에 있으므로 건드리지 않는다.
  // worker 프로세스가 살아있는 동안 migrate를 다시 돌리지 않는다.
}
