import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// D7-a 마이그레이션의 백필 SQL을 그대로 실행해, 기존 catalog 설정이 order 복제본으로 옮겨지는지 본다.
// 마이그레이션은 빈 DB에 적용되므로 여기서만 검증된다.
const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20260919150000_order_store_daily_limit/migration.sql',
);

function backfillStatements(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const body = sql.slice(
    sql.indexOf('-- backfill'),
    sql.indexOf('-- end backfill'),
  );
  return body
    .split(';')
    .map((stmt) => stmt.replace(/^\s*--[^\n]*$/gm, '').trim())
    .filter((stmt) => stmt.length > 0);
}

describe('order_store_daily_limit 백필 (real DB)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = await createTestingModuleWithRealDb({ providers: [] }));
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function runBackfill(): Promise<void> {
    const statements = backfillStatements();
    expect(statements).toHaveLength(1);
    for (const stmt of statements) await prisma.$executeRawUnsafe(stmt);
  }

  it('활성 설정만 복제하고 source_updated_at은 원본 updated_at을 그대로 쓴다', async () => {
    const store = await createStore(prisma);
    const active = await prisma.storeDailyCapacity.create({
      data: {
        store_id: store.id,
        capacity_date: new Date('2026-06-01T00:00:00.000Z'),
        capacity: 30,
      },
    });
    await prisma.storeDailyCapacity.create({
      data: {
        store_id: store.id,
        capacity_date: new Date('2026-06-02T00:00:00.000Z'),
        capacity: 40,
        deleted_at: new Date(),
      },
    });

    await runBackfill();

    const rows = await prisma.orderStoreDailyLimit.findMany();
    expect(rows).toMatchObject([
      {
        store_id: store.id,
        booking_date: active.capacity_date,
        capacity: 30,
        source_updated_at: active.updated_at,
      },
    ]);
  });

  it('반증: 설정이 없으면 복제본도 비어 있다(0건 통과가 아니라 대상이 없음을 확인)', async () => {
    await createStore(prisma);
    expect(await prisma.storeDailyCapacity.count()).toBe(0);

    await runBackfill();

    expect(await prisma.orderStoreDailyLimit.count()).toBe(0);
  });
});
