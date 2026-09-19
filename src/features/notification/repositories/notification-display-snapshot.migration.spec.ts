import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createNotification,
  createOrder,
  createOrderItem,
  createProduct,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 07a 마이그레이션의 백필 SQL을 그대로 실행해, 조회 시 폴백이 하던 규칙(직접 연결 우선, 주문 알림은 첫 품목 스냅샷·매장,
// 연관 ID 미저장 과거 알림은 ID까지 보강)이 컬럼에 물질화되는지 본다. 마이그레이션은 빈 DB에 적용되므로 여기서만 검증된다.
const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20260919120500_notification_display_snapshot/migration.sql',
);

function backfillStatements(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const body = sql.slice(sql.indexOf('-- backfill'));
  return body
    .split(';')
    .map((stmt) => stmt.replace(/^\s*--[^\n]*$/gm, '').trim())
    .filter((stmt) => stmt.length > 0);
}

describe('notification 표시 스냅샷 백필 (real DB)', () => {
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
    expect(statements).toHaveLength(4);
    for (const stmt of statements) await prisma.$executeRawUnsafe(stmt);
  }

  it('직접 연결 알림은 매장·상품 이름을, 주문 알림은 주문번호·첫 품목 스냅샷을 채운다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const store = await createStore(prisma, { store_name: '달콤 케이크' });
    const product = await createProduct(prisma, {
      store_id: store.id,
      name: '현재 상품명',
    });
    const liked = await createNotification(prisma, {
      account_id: account.id,
      type: 'REVIEW_LIKE',
      store_id: store.id,
      product_id: product.id,
    });
    const order = await createOrder(prisma, { account_id: account.id });
    await createOrderItem(prisma, {
      order_id: order.id,
      product_id: product.id,
      store_id: store.id,
      product_name_snapshot: '주문 시점 상품명',
    });
    const ordered = await createNotification(prisma, {
      account_id: account.id,
      type: 'ORDER_STATUS',
      order_id: order.id,
      store_id: store.id,
      product_id: product.id,
    });

    await runBackfill();

    const [likedRow, orderedRow] = await Promise.all([
      prisma.notification.findUniqueOrThrow({ where: { id: liked.id } }),
      prisma.notification.findUniqueOrThrow({ where: { id: ordered.id } }),
    ]);
    expect(likedRow).toMatchObject({
      store_name: '달콤 케이크',
      product_name: '현재 상품명',
      order_number: null,
    });
    // 주문 알림은 상품 개명에 안전하도록 주문 시점 스냅샷이 현재 상품명을 이긴다
    expect(orderedRow).toMatchObject({
      store_name: '달콤 케이크',
      product_name: '주문 시점 상품명',
      order_number: order.order_number,
    });
  });

  it('연관 ID를 안 남긴 과거 주문 알림은 첫 품목에서 매장·상품 ID까지 보강한다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const store = await createStore(prisma, { store_name: '해즈 케이크' });
    const product = await createProduct(prisma, { store_id: store.id });
    const order = await createOrder(prisma, { account_id: account.id });
    await createOrderItem(prisma, {
      order_id: order.id,
      product_id: product.id,
      store_id: store.id,
      product_name_snapshot: '주문 시점 상품명',
    });
    const legacy = await createNotification(prisma, {
      account_id: account.id,
      type: 'ORDER_STATUS',
      order_id: order.id,
    });

    await runBackfill();

    expect(
      await prisma.notification.findUniqueOrThrow({ where: { id: legacy.id } }),
    ).toMatchObject({
      store_id: store.id,
      product_id: product.id,
      store_name: '해즈 케이크',
      product_name: '주문 시점 상품명',
      order_number: order.order_number,
    });
  });

  it('반증: 백필은 주문·매장·상품이 없는 알림(SYSTEM)을 건드리지 않는다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const system = await createNotification(prisma, {
      account_id: account.id,
      type: 'SYSTEM',
    });
    await runBackfill();
    expect(
      await prisma.notification.findUniqueOrThrow({ where: { id: system.id } }),
    ).toMatchObject({
      store_name: null,
      product_name: null,
      order_number: null,
    });
  });
});
