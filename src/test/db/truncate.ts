import mysql from 'mysql2/promise';

import { getTestDatabaseUrl } from '@/test/db/prisma-test-client';

let cachedConn: mysql.Connection | null = null;
let cachedTableNames: string[] | null = null;

/** truncateAll을 단일 round-trip으로 수행하기 위해 multipleStatements를 활성화한다. */
async function getConnection(): Promise<mysql.Connection> {
  if (cachedConn) {
    try {
      await cachedConn.ping();
      return cachedConn;
    } catch {
      cachedConn = null;
    }
  }
  cachedConn = await mysql.createConnection({
    uri: getTestDatabaseUrl(),
    multipleStatements: true,
  });
  return cachedConn;
}

async function loadTableNames(conn: mysql.Connection): Promise<string[]> {
  if (cachedTableNames) return cachedTableNames;
  const [rows] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT TABLE_NAME AS table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_type = 'BASE TABLE'
      AND TABLE_NAME <> '_prisma_migrations'
  `);
  cachedTableNames = rows.map((r) => r.table_name as string);
  return cachedTableNames;
}

/**
 * TRUNCATE 대신 DELETE — MySQL에서 TRUNCATE는 빈 테이블이어도 .ibd 파일을 drop & recreate하지만 DELETE는 빈
 * 테이블에서 거의 즉시 리턴한다(대부분의 테스트가 소수 테이블만 건드린다). AUTO_INCREMENT는 리셋되지 않지만
 * 테스트가 상수 id에 의존하지 않아 무해하다.
 * multi-statement 중간 DELETE가 실패하면 MySQL은 후속 statement를 abort해 마지막 SET FOREIGN_KEY_CHECKS = 1이
 * 누락될 수 있고, 캐시된 connection이 FK 비활성 상태로 남아 후속 테스트의 FK 위반을 조용히 통과시킨다 —
 * 실패 시에만 별도 쿼리로 명시 복원한다.
 */
export async function truncateAll(): Promise<void> {
  const conn = await getConnection();
  const tables = await loadTableNames(conn);
  if (tables.length === 0) return;

  const deleteStatements = tables
    .map((name) => `DELETE FROM \`${name}\`;`)
    .join('\n');
  const sql = `SET FOREIGN_KEY_CHECKS = 0;\n${deleteStatements}\nSET FOREIGN_KEY_CHECKS = 1;`;

  try {
    await conn.query(sql);
  } catch (err) {
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    } catch {
      // 복원 자체가 실패해도 원래 에러를 우선 throw 한다.
    }
    throw err;
  }
}

export async function closeTruncateConnection(): Promise<void> {
  if (cachedConn) {
    await cachedConn.end();
    cachedConn = null;
  }
  cachedTableNames = null;
}
