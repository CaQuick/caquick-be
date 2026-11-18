import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createOrder } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 결제 도입 마이그레이션의 백필 SQL을 그대로 실행해 기존 주문·이력이 새 규칙(이력 주체, 판매자 노출, 결제 설정 행)으로
// 옮겨지는지 본다. 마이그레이션은 빈 DB에 적용되므로 백필은 여기서만 검증된다.
const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20261118150004_order_payment_schema/migration.sql',
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

describe('주문 결제 스키마 백필 (real DB)', () => {
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

  async function history(
    orderId: bigint,
    row: {
      from: 'SUBMITTED' | 'CONFIRMED' | null;
      to: 'SUBMITTED' | 'CONFIRMED' | 'CANCELED';
      note?: string;
    },
  ) {
    // 최신 스키마라 actor_type을 비울 수 없다 — 백필이 덮어쓰는지 보려고 SYSTEM으로 채워 둔다
    return prisma.orderStatusHistory.create({
      data: {
        order_id: orderId,
        from_status: row.from,
        to_status: row.to,
        note: row.note ?? null,
        actor_type: 'SYSTEM',
      },
    });
  }

  it('이력 주체: 최초는 구매자, [관리자] 접두 메모는 관리자, 나머지는 판매자다', async () => {
    const order = await createOrder(prisma, { status: 'CANCELED' });
    const first = await history(order.id, { from: null, to: 'SUBMITTED' });
    const seller = await history(order.id, {
      from: 'SUBMITTED',
      to: 'CONFIRMED',
      note: '[관리자]가 아닌 메모',
    });
    const admin = await history(order.id, {
      from: 'CONFIRMED',
      to: 'CANCELED',
      note: '[관리자] 가게 사정',
    });

    await runBackfill();

    const actors = await prisma.orderStatusHistory.findMany({
      where: { id: { in: [first.id, seller.id, admin.id] } },
      orderBy: { id: 'asc' },
      select: { actor_type: true },
    });
    expect(actors.map((a) => a.actor_type)).toEqual([
      'BUYER',
      'SELLER',
      'ADMIN',
    ]);
  });

  it('기존 취소 이력만 사유 기타·환불 0이 된다', async () => {
    const order = await createOrder(prisma, { status: 'CANCELED' });
    const confirmed = await history(order.id, {
      from: 'SUBMITTED',
      to: 'CONFIRMED',
    });
    const canceled = await history(order.id, {
      from: 'CONFIRMED',
      to: 'CANCELED',
    });

    await runBackfill();

    const rows = await prisma.orderStatusHistory.findMany({
      where: { id: { in: [confirmed.id, canceled.id] } },
      orderBy: { id: 'asc' },
      select: { cancel_reason: true, refund_amount: true },
    });
    expect(rows).toEqual([
      { cancel_reason: null, refund_amount: null },
      { cancel_reason: 'OTHER', refund_amount: 0 },
    ]);
  });

  it('입금 대기가 아닌 주문의 비어 있는 submitted_at을 생성 시각으로 채우고 이미 있는 값은 둔다', async () => {
    const created = new Date('2026-05-01T01:02:03.456Z');
    const kept = new Date('2026-05-02T00:00:00.000Z');
    const legacy = await createOrder(prisma, {
      status: 'CANCELED',
      created_at: created,
      submitted_at: null,
    });
    const pending = await createOrder(prisma, {
      status: 'PENDING_PAYMENT',
      created_at: created,
    });
    const already = await createOrder(prisma, {
      status: 'SUBMITTED',
      created_at: created,
      submitted_at: kept,
    });

    await runBackfill();

    const submittedAt = async (id: bigint) =>
      (await prisma.order.findUniqueOrThrow({ where: { id } })).submitted_at;
    expect(await submittedAt(legacy.id)).toEqual(created);
    expect(await submittedAt(pending.id)).toBeNull();
    expect(await submittedAt(already.id)).toEqual(kept);
  });

  it('결제 설정 행(id=1)을 하나 넣고 기본값은 수수료 0·계좌 없음이다', async () => {
    await runBackfill();
    expect(await prisma.paymentSetting.findMany()).toEqual([
      expect.objectContaining({
        id: 1,
        commission_rate_bps: 0,
        deposit_bank_code: null,
        deposit_account_number: null,
        deposit_account_holder: null,
      }),
    ]);
  });

  // 기존 값의 순번이 바뀌면 저장값이 다른 값으로 읽히고 INSTANT ALTER도 깨진다
  const STATUS = [
    'SUBMITTED CONFIRMED MADE PICKED_UP CANCELED',
    'PENDING_PAYMENT NO_SHOW',
  ];
  it.each([
    ['order', 'status', ...STATUS],
    ['order_status_history', 'to_status', ...STATUS],
    [
      'notification',
      'event',
      'REVIEW_LIKED ORDER_CONFIRMED ORDER_MADE ORDER_PICKED_UP ORDER_CANCELED',
      'ORDER_PAYMENT_CONFIRMED ORDER_PAYMENT_EXPIRED ORDER_NO_SHOW ' +
        'ORDER_PICKUP_RESCHEDULED REFUND_ACCOUNT_REQUESTED REFUND_COMPLETED',
    ],
    [
      'audit_log',
      'target_type',
      'STORE PRODUCT ORDER CONVERSATION CHANGE_PASSWORD ACCOUNT BANNER CATEGORY TAG ' +
        'REGION REVIEW REVIEW_COMMENT REVIEW_REPORT NOTIFICATION SEARCH_KEYWORD_CHIP',
      'PAYMENT_SETTING SETTLEMENT_ACCOUNT SETTLEMENT REFUND DEPOSIT_RECORD',
    ],
  ])(
    '%s.%s enum은 기존 값 순서를 지키고 새 값을 끝에 붙인다',
    async (table, column, existing, appended) => {
      const rows = await prisma.$queryRaw<{ column_type: string }[]>`
        SELECT COLUMN_TYPE AS column_type FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} AND COLUMN_NAME = ${column}`;
      const values = [...rows[0].column_type.matchAll(/'([^']+)'/g)].map(
        (m) => m[1],
      );
      expect(values).toEqual(`${existing} ${appended}`.split(' '));
    },
  );

  it('주문 상태 기본값은 입금 대기다', async () => {
    const rows = await prisma.$queryRaw<{ column_default: string }[]>`
      SELECT COLUMN_DEFAULT AS column_default FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order' AND COLUMN_NAME = 'status'`;
    expect(rows[0].column_default).toBe('PENDING_PAYMENT');
  });
});
