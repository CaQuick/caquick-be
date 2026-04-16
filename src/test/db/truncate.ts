import mysql from 'mysql2/promise';

import { getTestDatabaseUrl } from '@/test/db/prisma-test-client';

/**
 * 테스트 DB의 모든 테이블을 TRUNCATE한다.
 *
 * Prisma 커넥션 풀을 우회하여 단일 mysql2 연결에서 실행.
 * → SET FOREIGN_KEY_CHECKS=0 과 TRUNCATE가 동일 세션에서 보장됨.
 *
 * - `_prisma_migrations`는 제외 (스키마 이력 유지)
 */
export async function truncateAll(): Promise<void> {
  const dbUrl = getTestDatabaseUrl();
  const conn = await mysql.createConnection(dbUrl);

  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`
      SELECT TABLE_NAME AS table_name
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
        AND TABLE_NAME <> '_prisma_migrations'
    `);

    if (rows.length === 0) return;

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const row of rows) {
      await conn.query(`TRUNCATE TABLE \`${row.table_name}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await conn.end();
  }
}
