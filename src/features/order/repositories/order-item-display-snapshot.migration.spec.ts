import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createOrderItem, createProduct, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// P1-16 마이그레이션의 백필 SQL을 그대로 실행해, 주문 생성 경로와 같은 규칙(현재 매장명·활성 첫 이미지 sort_order 순)으로
// 기존 품목이 채워지는지 본다. 마이그레이션은 빈 DB에 적용되므로 여기서만 검증된다.
const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20260919130000_order_item_display_snapshot/migration.sql',
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

describe('order_item 표시 스냅샷 백필 (real DB)', () => {
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
    expect(statements).toHaveLength(2);
    for (const stmt of statements) await prisma.$executeRawUnsafe(stmt);
  }

  it('매장명과 활성 첫 이미지(sort_order·id 순)를 품목에 채운다', async () => {
    const store = await createStore(prisma, { store_name: '백필 매장' });
    const product = await createProduct(prisma, { store_id: store.id });
    for (const [url, sortOrder, deleted] of [
      ['https://img/deleted.png', 0, new Date()],
      ['https://img/second.png', 1, null],
      ['https://img/first.png', 0, null],
    ] as const) {
      await prisma.productImage.create({
        data: {
          product_id: product.id,
          image_url: url,
          sort_order: sortOrder,
          deleted_at: deleted,
        },
      });
    }
    // 백필 대상 재현: 스냅샷이 비어 있는(=마이그레이션 전) 품목
    const item = await createOrderItem(prisma, {
      product_id: product.id,
      store_name_snapshot: '',
      product_thumbnail_url_snapshot: null,
    });

    await runBackfill();

    const row = await prisma.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(row.store_name_snapshot).toBe('백필 매장');
    expect(row.product_thumbnail_url_snapshot).toBe('https://img/first.png');
  });

  it('반증: 이미지가 없는 상품의 품목은 썸네일이 null로 남고 매장명만 채워진다', async () => {
    const item = await createOrderItem(prisma, { store_name_snapshot: '' });
    await runBackfill();
    const row = await prisma.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(row.store_name_snapshot).not.toBe('');
    expect(row.product_thumbnail_url_snapshot).toBeNull();
  });
});
