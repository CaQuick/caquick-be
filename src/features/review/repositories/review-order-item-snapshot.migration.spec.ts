import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createOrderItem, createReview } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 07b 마이그레이션의 백필 SQL을 그대로 실행해, 작성 시점 스냅샷 규칙(품목 상품명·활성 옵션 id 순·활성 크롭 첫 장)이
// 기존 리뷰에 같은 값으로 채워지는지 본다. 마이그레이션은 빈 DB에 적용되므로 여기서만 검증된다.
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

  async function runBackfill(): Promise<void> {
    const statements = backfillStatements();
    expect(statements).toHaveLength(3);
    for (const stmt of statements) await prisma.$executeRawUnsafe(stmt);
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
    await prisma.orderItemCustomFreeEdit.create({
      data: {
        order_item_id: orderItem.id,
        crop_image_url: 'https://img/second.png',
        description_text: '둘째',
        sort_order: 1,
      },
    });
    await prisma.orderItemCustomFreeEdit.create({
      data: {
        order_item_id: orderItem.id,
        crop_image_url: 'https://img/first.png',
        description_text: '첫째',
        sort_order: 0,
      },
    });
    // 백필 대상 재현: 스냅샷이 비어 있는(=마이그레이션 전) 리뷰
    const review = await createReview(prisma, {
      order_item_id: orderItem.id,
      product_name_snapshot: '',
      option_summary: null,
      before_image_url: null,
    });

    await runBackfill();

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
