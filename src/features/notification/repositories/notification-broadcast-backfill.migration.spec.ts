import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { OutboxStatus, PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createAccountCredential } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 발송 이력 마이그레이션의 백필 SQL을 그대로 실행해 과거 발송 요청(outbox)이 이력 행으로 복원되는지 본다.
// 마이그레이션은 빈 DB에 적용되므로 여기서만 검증된다.
const MIGRATIONS = join(__dirname, '../../../../prisma/migrations');
const MIGRATION = join(
  MIGRATIONS,
  readdirSync(MIGRATIONS).find((d) => d.endsWith('_notification_broadcast'))!,
  'migration.sql',
);

function backfillStatements(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const body = sql.slice(sql.indexOf('-- backfill'));
  return body
    .split(';')
    .map((stmt) => stmt.replace(/^\s*--[^\n]*$/gm, '').trim())
    .filter((stmt) => stmt.length > 0);
}

const OCCURRED_AT = new Date('2026-09-30T03:00:00.000Z');

describe('notification_broadcast 백필 (real DB)', () => {
  let prisma: PrismaClient;
  let seq = 0;

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

  async function outboxRow(args: {
    payload: object;
    actor?: bigint | null;
    status?: OutboxStatus;
    eventType?: string;
    eventId?: string;
  }): Promise<string> {
    seq += 1;
    const eventId =
      args.eventId ??
      `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
    await prisma.outbox.create({
      data: {
        event_id: eventId,
        aggregate_type: 'notification-broadcast',
        aggregate_id: eventId,
        event_type: args.eventType ?? 'notification.broadcast_requested',
        payload_json: args.payload,
        occurred_at: OCCURRED_AT,
        actor_account_id: args.actor === undefined ? 1n : args.actor,
        status: args.status ?? 'PUBLISHED',
        next_attempt_at: OCCURRED_AT,
      },
    });
    return eventId;
  }

  function accountIdsPayload(accountIds: string[], skipped: string[] = []) {
    return {
      type: 'MARKETING',
      title: '가을 이벤트',
      body: '본문',
      audience: { kind: 'ACCOUNT_IDS', accountIds },
      skippedAccountIds: skipped,
    };
  }

  it('ACCOUNT_IDS 요청은 내용·대상·제외 ID·발송자 라벨·실제 저장 수·완료 시각까지 복원한다', async () => {
    const actor = await createAccount(prisma, {
      account_type: 'ADMIN',
      name: '이찬우',
    });
    await createAccountCredential(prisma, {
      account_id: actor.id,
      username: 'chanwoo7',
    });
    const [a, b] = await Promise.all([
      createAccount(prisma, { account_type: 'USER' }),
      createAccount(prisma, { account_type: 'USER' }),
    ]);
    const eventId = await outboxRow({
      actor: actor.id,
      payload: accountIdsPayload([a.id, b.id].map(String), ['999']),
    });
    // 저장된 2건 중 1건은 삭제 처리 — 알림센터 조회와 같게 빼고 센다
    for (const account of [a, b]) {
      await prisma.notification.create({
        data: {
          account_id: account.id,
          type: 'MARKETING',
          title: '가을 이벤트',
          body: '본문',
          source_event_id: eventId,
          deleted_at: account === b ? OCCURRED_AT : null,
        },
      });
    }

    await runBackfill();

    expect(await prisma.notificationBroadcast.findMany()).toEqual([
      expect.objectContaining({
        event_id: eventId,
        actor_account_id: actor.id,
        actor_label: '이찬우(chanwoo7)',
        type: 'MARKETING',
        title: '가을 이벤트',
        body: '본문',
        target_kind: 'ACCOUNT_IDS',
        target_count: 2,
        skipped_count: 1,
        target_account_ids: [a.id, b.id].map(String),
        skipped_account_ids: ['999'],
        delivered_count: 1,
        completed_at: OCCURRED_AT,
        created_at: OCCURRED_AT,
      }),
    ]);
  });

  it.each([
    ['ALL_USERS', 3],
    ['ALL_USERS 대상 0명', 0],
  ])(
    '%s 요청은 확정 건수를 대상 수로 복원하고 대상 ID는 null이다',
    async (_label, count) => {
      await outboxRow({
        payload: {
          type: 'SYSTEM',
          title: '점검',
          body: '본문',
          audience: { kind: 'ALL_USERS', maxAccountId: '10', count },
          skippedAccountIds: [],
        },
      });

      await runBackfill();

      expect(
        await prisma.notificationBroadcast.findFirstOrThrow(),
      ).toMatchObject({
        type: 'SYSTEM',
        target_kind: 'ALL_USERS',
        target_count: count,
        skipped_count: 0,
        target_account_ids: null,
        skipped_account_ids: [],
        delivered_count: 0,
      });
    },
  );

  it.each([
    ['이름·아이디', '이찬우', 'chanwoo7', false, '이찬우(chanwoo7)'],
    ['이름만', '이찬우', null, false, '이찬우'],
    ['아이디만', null, 'chanwoo7', false, 'chanwoo7'],
    ['공백 이름', '  ', 'chanwoo7', false, 'chanwoo7'],
    ['삭제된 자격증명', '이찬우', 'chanwoo7', true, '이찬우'],
    ['둘 다 없음', null, null, false, null],
  ])(
    '발송자 라벨은 앱과 같은 규칙이다: %s',
    async (_label, name, username, credentialDeleted, expected) => {
      const actor = await createAccount(prisma, {
        account_type: 'ADMIN',
        name,
      });
      if (username !== null) {
        const credential = await createAccountCredential(prisma, {
          account_id: actor.id,
          username,
        });
        if (credentialDeleted) {
          await prisma.accountCredential.update({
            where: { id: credential.id },
            data: { deleted_at: OCCURRED_AT },
          });
        }
      }
      await outboxRow({ actor: actor.id, payload: accountIdsPayload(['1']) });

      await runBackfill();

      expect(
        (await prisma.notificationBroadcast.findFirstOrThrow()).actor_label,
      ).toBe(expected);
    },
  );

  it('발송자 계정이 없으면 라벨은 null이고 행은 복원한다', async () => {
    await outboxRow({ actor: 987_654n, payload: accountIdsPayload(['1']) });
    await runBackfill();
    expect(await prisma.notificationBroadcast.findFirstOrThrow()).toMatchObject(
      { actor_account_id: 987_654n, actor_label: null },
    );
  });

  it.each([
    ['PENDING', 'PENDING' as const],
    ['FAILED', 'FAILED' as const],
  ])(
    '%s 이벤트는 미완료(completed_at null)로 남긴다',
    async (_label, status) => {
      await outboxRow({ status, payload: accountIdsPayload(['1']) });
      await runBackfill();
      expect(
        await prisma.notificationBroadcast.findFirstOrThrow(),
      ).toMatchObject({ completed_at: null, delivered_count: 0 });
    },
  );

  it.each([
    [
      '옛 형식(targetAccountIds, audience 없음)',
      {
        payload: {
          type: 'SYSTEM',
          title: '옛 공지',
          body: '본문',
          targetAccountIds: ['1'],
          skippedAccountIds: [],
        },
      },
    ],
    [
      '알 수 없는 audience.kind',
      {
        payload: {
          ...accountIdsPayload(['1']),
          audience: { kind: 'SELLERS', accountIds: ['1'] },
        },
      },
    ],
    [
      '관리자 발송 분류가 아닌 type',
      { payload: { ...accountIdsPayload(['1']), type: 'ORDER_STATUS' } },
    ],
    ['행위자 없음', { actor: null, payload: accountIdsPayload(['1']) }],
    [
      '다른 이벤트 종류',
      { eventType: 'order.status_changed', payload: accountIdsPayload(['1']) },
    ],
  ])(
    '반증: %s 행은 마이그레이션을 멈추지 않고 건너뛴다',
    async (_label, row) => {
      await outboxRow(row);
      const valid = await outboxRow({ payload: accountIdsPayload(['1']) });

      await runBackfill();

      expect(
        (await prisma.notificationBroadcast.findMany()).map((r) => r.event_id),
      ).toEqual([valid]);
    },
  );

  it('이력 id 순서는 outbox 요청 순서를 따른다(event_id 순서와 무관)', async () => {
    // event_id 사전순을 요청 순서와 반대로 둔다
    const ids = [
      'ffffffff-0000-4000-8000-000000000001',
      '88888888-0000-4000-8000-000000000002',
      '11111111-0000-4000-8000-000000000003',
    ];
    for (const eventId of ids) {
      await outboxRow({ eventId, payload: accountIdsPayload(['1']) });
    }

    await runBackfill();

    const rows = await prisma.notificationBroadcast.findMany({
      orderBy: { id: 'asc' },
    });
    expect(rows.map((r) => r.event_id)).toEqual(ids);
  });
});
