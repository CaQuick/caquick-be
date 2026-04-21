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
let schemaApplied = false;

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
  if (schemaApplied) return;

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

  schemaApplied = true;
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
  // schemaApplied는 유지한다. 같은 worker 프로세스 내에서 DB는 동일하므로
  // migrate를 다시 돌릴 필요가 없고, 재실행 시 mysql admin 연결이 flaky해
  // "Connection lost" 오류를 유발할 수 있다 (PR 7 CI에서 관측됨).
}
