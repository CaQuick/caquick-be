import mysql from 'mysql2/promise';

import { getTestDatabaseUrl } from '@/test/db/prisma-test-client';

let cachedConn: mysql.Connection | null = null;
let cachedTableNames: string[] | null = null;

/**
 * Worker별로 캐싱된 mysql2 연결을 반환한다.
 * 연결이 끊겼으면 재생성한다.
 * truncateAll을 단일 round-trip으로 수행하기 위해 multipleStatements를 활성화.
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
  cachedConn = await mysql.createConnection({
    uri: getTestDatabaseUrl(),
    multipleStatements: true,
  });
  return cachedConn;
}

/**
 * worker 프로세스 동안 테이블 목록은 변하지 않으므로 1회만 조회해 재사용한다.
 */
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
 * 테스트 DB의 모든 테이블 데이터를 초기화한다.
 *
 * TRUNCATE 대신 DELETE를 사용한다: MySQL에서 TRUNCATE는 빈 테이블이어도 .ibd 파일을
 * drop & recreate하므로 per-statement 비용이 크지만, DELETE는 빈 테이블에서 거의
 * 즉시 리턴한다. 테스트 대부분이 소수 테이블만 건드리고 나머지는 비어있으므로
 * 실측상 DELETE가 훨씬 빠르다.
 *
 * 트레이드오프: AUTO_INCREMENT 값이 리셋되지 않는다. 우리 테스트는 factory가 반환한
 * id를 들고 사용하지 상수 id에 의존하지 않으므로 무해하다.
 *
 * - multi-statement 배치로 1회 round-trip
 * - SET FOREIGN_KEY_CHECKS=0 으로 FK 순서 무시
 * - `_prisma_migrations`는 제외 (스키마 이력 유지)
 *
 * FK 복원 안전성:
 *   multi-statement 중간 DELETE가 실패하면 MySQL은 후속 statement를 실행하지 않고
 *   abort하므로 마지막의 `SET FOREIGN_KEY_CHECKS = 1`이 누락될 수 있다. 이 경우
 *   캐시된 connection은 FK 비활성 상태로 남아 후속 테스트의 FK 위반을 silent하게
 *   통과시킬 위험이 있다. 성공 케이스의 1 round-trip 성능은 유지하면서, 실패 시에만
 *   별도 쿼리로 명시 복원한다.
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

/**
 * Worker 종료 시 캐싱된 연결을 정리한다.
 */
export async function closeTruncateConnection(): Promise<void> {
  if (cachedConn) {
    await cachedConn.end();
    cachedConn = null;
  }
  cachedTableNames = null;
}
