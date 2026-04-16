import type { PrismaClient } from '@prisma/client';

/**
 * 테스트 DB의 모든 테이블을 TRUNCATE한다.
 *
 * - `_prisma_migrations`는 제외 (스키마 이력 유지)
 * - 외래 키 제약 일시 해제 후 수행 → 다시 활성화
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(`
    SELECT TABLE_NAME AS table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_type = 'BASE TABLE'
      AND TABLE_NAME <> '_prisma_migrations'
  `);

  if (rows.length === 0) return;

  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const { table_name } of rows) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table_name}\``);
    }
  } finally {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  }
}
