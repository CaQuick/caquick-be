import mysql from 'mysql2/promise';

import { getTestDatabaseUrl } from '@/test/db/prisma-test-client';

let cachedConn: mysql.Connection | null = null;

/**
 * Worker별로 캐싱된 mysql2 연결을 반환한다.
 * 연결이 끊겼으면 재생성한다.
 */
async function getConnection(): Promise<mysql.Connection> {
  if (cachedConn) {
    try {
      await cachedConn.ping();
      return cachedConn;
    } catch {
      cachedConn = null;
    }
  }
  cachedConn = await mysql.createConnection(getTestDatabaseUrl());
  return cachedConn;
}

/**
 * 테스트 DB의 모든 테이블을 TRUNCATE한다.
 *
 * Prisma 커넥션 풀을 우회하여 단일 mysql2 연결에서 실행.
 * → SET FOREIGN_KEY_CHECKS=0 과 TRUNCATE가 동일 세션에서 보장됨.
 *
 * - `_prisma_migrations`는 제외 (스키마 이력 유지)
 */
export async function truncateAll(): Promise<void> {
  const conn = await getConnection();

  const [rows] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT TABLE_NAME AS table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_type = 'BASE TABLE'
      AND TABLE_NAME <> '_prisma_migrations'
  `);

  if (rows.length === 0) return;

  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const row of rows) {
      await conn.query(`TRUNCATE TABLE \`${row.table_name}\``);
    }
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

/**
 * Worker 종료 시 캐싱된 연결을 정리한다.
 */
export async function closeTruncateConnection(): Promise<void> {
  if (cachedConn) {
    await cachedConn.end();
    cachedConn = null;
  }
}
