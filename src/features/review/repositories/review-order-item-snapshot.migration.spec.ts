import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import mysql, { type RowDataPacket } from 'mysql2/promise';

import type { PrismaClient } from '@/generated/prisma/client';
import {
  disconnectTestPrismaClient,
  getTestDatabaseUrl,
} from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createOrderItem, createReview } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 07b 마이그레이션의 백필 SQL을 그대로 실행해, 작성 시점 스냅샷 규칙(품목 상품명·활성 옵션 id 순·활성 크롭 첫 장)이
// 기존 리뷰에 같은 값으로 채워지는지 본다. 마이그레이션은 빈 DB에 적용되므로 여기서만 검증된다.
// 백필이 읽는 자유 편집 crop_image_url은 뒤 마이그레이션에서 지워져, 그 열을 더한 임시 표로 같은 이름을 가린 연결 하나에서 돌린다.
const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20260919123000_review_order_item_snapshot/migration.sql',
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

describe('review 주문 품목 스냅샷 백필 (real DB)', () => {
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

  /** crop_image_url이 있던 자유 편집 표로 가린 연결에서 크롭을 넣고 백필을 돌린다(임시 표는 세션 범위). */
  async function runBackfill(
    crops: Array<{ orderItemId: bigint; url: string; sortOrder: number }> = [],
  ): Promise<void> {
    const statements = backfillStatements();
    expect(statements).toHaveLength(3);
    const conn = await mysql.createConnection({ uri: getTestDatabaseUrl() });
    try {
      const table = 'order_item_custom_free_edit';
      await conn.query(
        `CREATE TEMPORARY TABLE \`_legacy_${table}\` LIKE \`${table}\``,
      );
      await conn.query(
        `CREATE TEMPORARY TABLE \`${table}\` LIKE \`_legacy_${table}\``,
      );
      const [[shown]] = await conn.query<RowDataPacket[]>(
        `SHOW CREATE TABLE \`${table}\``,
      );
      expect(String(shown['Create Table'])).toMatch(/^CREATE TEMPORARY TABLE/);
      await conn.query(
        `ALTER TABLE \`${table}\` ADD COLUMN crop_image_url VARCHAR(2048) NOT NULL`,
      );
      for (const crop of crops) {
        await conn.query(
          `INSERT INTO \`${table}\` (order_item_id, crop_image_url, description_text, sort_order, pos_x, pos_y, width, height, updated_at) VALUES (?, ?, '요청', ?, 0, 0, 10000, 10000, NOW(3))`,
          [crop.orderItemId, crop.url, crop.sortOrder],
        );
      }
      for (const stmt of statements) await conn.query(stmt);
    } finally {
      await conn.end();
    }
  }

  it('상품명·활성 옵션(id 순)·활성 크롭 첫 장(sort_order 순)을 리뷰에 채운다', async () => {
    const orderItem = await createOrderItem(prisma, {
      product_name_snapshot: '주문 시점 상품명',
    });
    const group = await prisma.productOptionGroup.create({
      data: { product_id: orderItem.product_id, name: '모양' },
    });
    const [first, second] = await Promise.all([
      prisma.productOptionItem.create({
        data: { option_group_id: group.id, title: '동그라미' },
      }),
      prisma.productOptionItem.create({
        data: { option_group_id: group.id, title: '하트' },
      }),
    ]);
    for (const [item, title, deleted] of [
      [first, '동그라미', null],
      [second, '하트', new Date()],
    ] as const) {
      await prisma.orderItemOptionItem.create({
        data: {
          order_item_id: orderItem.id,
          option_group_id: group.id,
          option_item_id: item.id,
          group_name_snapshot: '모양',
          option_title_snapshot: title,
          deleted_at: deleted,
        },
      });
    }
    // 백필 대상 재현: 스냅샷이 비어 있는(=마이그레이션 전) 리뷰
    const review = await createReview(prisma, {
      order_item_id: orderItem.id,
      product_name_snapshot: '',
      option_summary: null,
      before_image_url: null,
    });

    await runBackfill([
      {
        orderItemId: orderItem.id,
        url: 'https://img/second.png',
        sortOrder: 1,
      },
      { orderItemId: orderItem.id, url: 'https://img/first.png', sortOrder: 0 },
    ]);

    const row = await prisma.review.findUniqueOrThrow({
      where: { id: review.id },
    });
    expect(row.product_name_snapshot).toBe('주문 시점 상품명');
    // 삭제된 옵션은 빠지고, 활성 옵션만 id 순
    expect(row.option_summary).toEqual([
      { groupName: '모양', optionTitle: '동그라미' },
    ]);
    expect(row.before_image_url).toBe('https://img/first.png');
  });

  it('반증: 옵션·크롭이 없는 품목의 리뷰는 option_summary·before_image_url이 null로 남는다', async () => {
    const review = await createReview(prisma, {
      product_name_snapshot: '',
    });
    await runBackfill();
    const row = await prisma.review.findUniqueOrThrow({
      where: { id: review.id },
    });
    expect(row.product_name_snapshot).not.toBe('');
    expect(row.option_summary).toBeNull();
    expect(row.before_image_url).toBeNull();
  });
});
