import { ClockService } from '@/common/providers/clock.service';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { AdminNotificationService } from '@/features/notification/services/notification-admin.service';
import { NotificationOutboxConsumer } from '@/features/notification/services/notification-outbox.consumer';
import { OutboxDispatcherService } from '@/features/outbox';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createAccountCredential } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import {
  drainOutbox,
  OUTBOX_TEST_IMPORTS,
  outboxTestProviders,
} from '@/test/outbox';

const T0 = new Date('2026-10-01T09:00:00.000Z');
const MINUTE = 60_000;

describe('AdminNotificationService (real DB)', () => {
  let now = T0;
  let service: AdminNotificationService;
  let dispatcher: OutboxDispatcherService;
  let auditLogs: IAuditLogRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      imports: OUTBOX_TEST_IMPORTS,
      providers: [
        AdminNotificationService,
        NotificationAdminRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        ...outboxTestProviders({ clock: true }),
        { provide: ClockService, useValue: { now: () => now } },
        NotificationOutboxConsumer,
        NotificationRepository,
      ],
    });
    service = module.get(AdminNotificationService);
    dispatcher = module.get(OutboxDispatcherService);
    auditLogs = module.get(AUDIT_LOG_REPOSITORY);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    now = T0;
    await truncateAll();
  });

  async function admin(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }
  async function bulkUsers(count: number): Promise<void> {
    await prisma.account.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        account_type: 'USER' as const,
        status: 'ACTIVE' as const,
        email: `bulk${i}@example.com`,
      })),
    });
  }

  const base = {
    type: 'SYSTEM' as const,
    title: '  점검 안내  ',
    body: '오늘 밤 점검이 있습니다.',
    idempotencyKey: 'notice-2026-09-19',
  };

  describe('ACCOUNT_IDS', () => {
    it('활성 USER만 대상으로 확정(중복 ID는 한 번), 나머지는 skippedAccountIds, 이벤트 1건·감사 1건, 저장은 소비자가 한다', async () => {
      const actor = await admin();
      const user = await createAccount(prisma, { account_type: 'USER' });
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      const suspended = await createAccount(prisma, {
        account_type: 'USER',
        status: 'SUSPENDED',
      });
      const gone = await createAccount(prisma, {
        account_type: 'USER',
        deleted_at: new Date(),
      });

      const result = await service.adminSendNotification(actor, {
        ...base,
        targetKind: 'ACCOUNT_IDS',
        accountIds: [
          user.id,
          user.id,
          seller.id,
          suspended.id,
          gone.id,
          BigInt(999_999),
        ].map(String),
      });

      expect(result.sentCount).toBe(1);
      expect(result.skippedAccountIds).toEqual(
        [seller.id, suspended.id, gone.id, BigInt(999_999)].map(String),
      );
      // 응답 시점엔 이벤트만 있고 알림은 아직 없다
      expect(await prisma.outbox.count()).toBe(1);
      expect(await prisma.notification.count()).toBe(0);

      await drainOutbox(dispatcher);
      const rows = await prisma.notification.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        account_id: user.id,
        type: 'SYSTEM',
        title: '점검 안내',
        body: base.body,
        event: null,
      });
      expect(rows[0].source_event_id).not.toBeNull();
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'NOTIFICATION', actor_account_id: actor },
      });
      expect(audit.after_json).toMatchObject({
        type: 'SYSTEM',
        targetKind: 'ACCOUNT_IDS',
        sentCount: 1,
        skippedCount: 4,
        eventId: rows[0].source_event_id,
      });
    });
  });

  describe('ALL_USERS', () => {
    it('활성 USER 전체를 대상으로 확정하고 SELLER·ADMIN·정지·탈퇴는 제외한다', async () => {
      const actor = await admin();
      const users = await Promise.all([
        createAccount(prisma, { account_type: 'USER' }),
        createAccount(prisma, { account_type: 'USER' }),
      ]);
      await createAccount(prisma, { account_type: 'SELLER' });
      await createAccount(prisma, {
        account_type: 'USER',
        status: 'SUSPENDED',
      });
      await createAccount(prisma, {
        account_type: 'USER',
        deleted_at: new Date(),
      });

      const result = await service.adminSendNotification(actor, {
        ...base,
        type: 'MARKETING',
        targetKind: 'ALL_USERS',
      });

      expect(result).toEqual({
        sentCount: 2,
        skippedAccountIds: [],
        broadcastId: expect.any(String),
      });
      await drainOutbox(dispatcher);
      const rows = await prisma.notification.findMany({
        orderBy: { account_id: 'asc' },
      });
      expect(rows.map((r) => r.account_id)).toEqual(
        users.map((u) => u.id).sort((a, b) => (a < b ? -1 : 1)),
      );
      expect(rows.every((r) => r.type === 'MARKETING')).toBe(true);
    });

    it('대상은 요청 시점 컷오프로 확정된다 — 응답 뒤 가입한 USER는 받지 않고 payload에 계정 목록을 싣지 않는다', async () => {
      const actor = await admin();
      const early = await createAccount(prisma, { account_type: 'USER' });

      const result = await service.adminSendNotification(actor, {
        ...base,
        targetKind: 'ALL_USERS',
      });
      const late = await createAccount(prisma, { account_type: 'USER' });

      expect(result.sentCount).toBe(1);
      const [row] = await prisma.outbox.findMany();
      expect(row.payload_json).toMatchObject({
        audience: {
          kind: 'ALL_USERS',
          maxAccountId: early.id.toString(),
          count: 1,
        },
      });
      await drainOutbox(dispatcher);
      expect(
        (await prisma.notification.findMany()).map((n) => n.account_id),
      ).toEqual([early.id]);
      expect(
        await prisma.notification.count({ where: { account_id: late.id } }),
      ).toBe(0);
    });

    it('청크(1,000) 경계를 넘어도 빠짐없이 한 번씩 저장하고, 소비자 재전달에도 중복되지 않는다', async () => {
      const actor = await admin();
      await bulkUsers(1_050);

      const result = await service.adminSendNotification(actor, {
        ...base,
        targetKind: 'ALL_USERS',
      });
      expect(result.sentCount).toBe(1_050);

      expect(await drainOutbox(dispatcher)).toMatchObject({ published: 1 });
      expect(await prisma.notification.count()).toBe(1_050);

      // at-least-once 재전달 재현: 같은 이벤트를 다시 PENDING으로 돌려 소비 → (source_event_id, account_id) unique로 흡수
      await prisma.outbox.updateMany({ data: { status: 'PENDING' } });
      expect(await drainOutbox(dispatcher)).toMatchObject({ published: 1 });
      expect(await prisma.notification.count()).toBe(1_050);
      const dup = await prisma.notification.groupBy({
        by: ['account_id'],
        _count: { _all: true },
        having: { account_id: { _count: { gt: 1 } } },
      });
      expect(dup).toHaveLength(0);
    });
  });

  describe('idempotencyKey', () => {
    it('같은 관리자·같은 키의 재요청은 이벤트를 다시 적재하지 않고 처음 응답을 재생한다(입력이 달라도)', async () => {
      const actor = await admin();
      const user = await createAccount(prisma, { account_type: 'USER' });
      const later = await createAccount(prisma, { account_type: 'USER' });

      const first = await service.adminSendNotification(actor, {
        ...base,
        targetKind: 'ACCOUNT_IDS',
        accountIds: [user.id.toString(), '999999'],
      });
      const replay = await service.adminSendNotification(actor, {
        ...base,
        title: '다른 제목',
        targetKind: 'ACCOUNT_IDS',
        accountIds: [later.id.toString()],
      });

      expect(replay).toEqual(first);
      expect(await prisma.outbox.count()).toBe(1);
      expect(await prisma.notificationBroadcast.count()).toBe(1);
      expect(
        await prisma.auditLog.count({ where: { target_type: 'NOTIFICATION' } }),
      ).toBe(1);
      await drainOutbox(dispatcher);
      expect(
        (await prisma.notification.findMany()).map((n) => n.account_id),
      ).toEqual([user.id]);
    });

    it('같은 키의 동시 요청은 둘 다 성공하고 이벤트·감사는 1건이다(진 쪽은 tx 밖 재조회로 재생)', async () => {
      const actor = await admin();
      const user = await createAccount(prisma, { account_type: 'USER' });
      const input = {
        ...base,
        targetKind: 'ACCOUNT_IDS' as const,
        accountIds: [user.id.toString()],
      };

      const results = await Promise.all([
        service.adminSendNotification(actor, input),
        service.adminSendNotification(actor, input),
      ]);

      expect(results[0]).toEqual(results[1]);
      expect(await prisma.outbox.count()).toBe(1);
      expect(await prisma.notificationBroadcast.count()).toBe(1);
      expect(
        await prisma.auditLog.count({ where: { target_type: 'NOTIFICATION' } }),
      ).toBe(1);
    });

    it('감사 기록이 실패하면 이벤트도 남지 않는다(같은 tx) — 재요청이 정상 적재·감사한다', async () => {
      const actor = await admin();
      const user = await createAccount(prisma, { account_type: 'USER' });
      const input = {
        ...base,
        targetKind: 'ACCOUNT_IDS' as const,
        accountIds: [user.id.toString()],
      };
      const spy = jest
        .spyOn(auditLogs, 'recordAudit')
        .mockRejectedValueOnce(new Error('audit down'));

      await expect(service.adminSendNotification(actor, input)).rejects.toThrow(
        'audit down',
      );
      expect(await prisma.outbox.count()).toBe(0);
      expect(await prisma.notificationBroadcast.count()).toBe(0);
      spy.mockRestore();

      await service.adminSendNotification(actor, input);
      expect(await prisma.outbox.count()).toBe(1);
      expect(
        await prisma.auditLog.count({ where: { target_type: 'NOTIFICATION' } }),
      ).toBe(1);
    });

    it('반증: 다른 관리자의 같은 키, 같은 관리자의 다른 키는 별도 발송이다', async () => {
      const [actorA, actorB] = await Promise.all([admin(), admin()]);
      const user = await createAccount(prisma, { account_type: 'USER' });
      const input = {
        ...base,
        targetKind: 'ACCOUNT_IDS' as const,
        accountIds: [user.id.toString()],
      };

      await service.adminSendNotification(actorA, input);
      await service.adminSendNotification(actorB, input);
      await service.adminSendNotification(actorA, {
        ...input,
        idempotencyKey: 'notice-2026-09-20',
      });

      expect(await prisma.outbox.count()).toBe(3);
      await drainOutbox(dispatcher);
      expect(
        await prisma.notification.count({ where: { account_id: user.id } }),
      ).toBe(3);
    });
  });

  describe('발송 이력', () => {
    const input = {
      ...base,
      targetKind: 'ACCOUNT_IDS' as const,
    };

    async function namedAdmin(
      name: string | null,
      username: string | null,
    ): Promise<bigint> {
      const account = await createAccount(prisma, {
        account_type: 'ADMIN',
        name,
      });
      if (username !== null) {
        await createAccountCredential(prisma, {
          account_id: account.id,
          username,
        });
      }
      return account.id;
    }

    it('발송 요청과 같은 tx에 이력 1행을 남기고 broadcastId·요청 시각·대상·제외 ID를 기록한다', async () => {
      const actor = await namedAdmin('이찬우', 'chanwoo7');
      const user = await createAccount(prisma, { account_type: 'USER' });

      const result = await service.adminSendNotification(actor, {
        ...input,
        accountIds: [user.id.toString(), '999999'],
      });

      const row = await prisma.notificationBroadcast.findFirstOrThrow();
      const event = await prisma.outbox.findFirstOrThrow();
      expect(result.broadcastId).toBe(row.id.toString());
      expect(row).toMatchObject({
        event_id: event.event_id,
        actor_account_id: actor,
        actor_label: '이찬우(chanwoo7)',
        type: 'SYSTEM',
        title: '점검 안내',
        body: base.body,
        target_kind: 'ACCOUNT_IDS',
        target_count: 1,
        skipped_count: 1,
        target_account_ids: [user.id.toString()],
        skipped_account_ids: ['999999'],
        delivered_count: null,
        completed_at: null,
        created_at: T0,
      });
      expect(event.occurred_at).toEqual(T0);
    });

    it('ALL_USERS 이력은 대상 ID를 싣지 않고(null) 제외 ID는 빈 배열이다', async () => {
      const actor = await admin();
      await createAccount(prisma, { account_type: 'USER' });

      await service.adminSendNotification(actor, {
        ...base,
        targetKind: 'ALL_USERS',
      });

      expect(
        await prisma.notificationBroadcast.findFirstOrThrow(),
      ).toMatchObject({
        target_kind: 'ALL_USERS',
        target_count: 1,
        skipped_count: 0,
        target_account_ids: null,
        skipped_account_ids: [],
      });
    });

    it.each([
      ['이름·아이디', '이찬우', 'chanwoo7', false, '이찬우(chanwoo7)'],
      ['이름만', '이찬우', null, false, '이찬우'],
      ['아이디만', null, 'chanwoo7', false, 'chanwoo7'],
      ['공백 이름', '  ', 'chanwoo7', false, 'chanwoo7'],
      ['삭제된 자격증명', '이찬우', 'chanwoo7', true, '이찬우'],
      ['둘 다 없음', null, null, false, null],
    ])(
      '발송자 라벨 스냅샷: %s',
      async (_label, name, username, credentialDeleted, expected) => {
        const actor = await namedAdmin(name, username);
        if (credentialDeleted) {
          await prisma.accountCredential.updateMany({
            where: { account_id: actor },
            data: { deleted_at: T0 },
          });
        }
        const user = await createAccount(prisma, { account_type: 'USER' });

        await service.adminSendNotification(actor, {
          ...input,
          accountIds: [user.id.toString()],
        });

        const [row] = await prisma.notificationBroadcast.findMany();
        expect(row.actor_label).toBe(expected);
        const {
          items: [item],
        } = await service.adminNotificationBroadcasts(actor);
        expect(item.actorLabel).toBe(expected);
      },
    );

    it('같은 키의 재요청은 이력을 새로 만들지 않고 처음 이력 ID를 돌려준다', async () => {
      const actor = await admin();
      const user = await createAccount(prisma, { account_type: 'USER' });
      const first = await service.adminSendNotification(actor, {
        ...input,
        accountIds: [user.id.toString()],
      });
      now = new Date(T0.getTime() + MINUTE);
      const replay = await service.adminSendNotification(actor, {
        ...input,
        title: '다른 제목',
        accountIds: [user.id.toString()],
      });

      expect(replay.broadcastId).toBe(first.broadcastId);
      const rows = await prisma.notificationBroadcast.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ title: '점검 안내', created_at: T0 });
    });

    it('목록은 최신 요청이 먼저 오고 유형·대상 필터와 커서로 나눠 본다', async () => {
      const actor = await admin();
      const user = await createAccount(prisma, { account_type: 'USER' });
      const sends: [
        string,
        'SYSTEM' | 'MARKETING',
        'ALL_USERS' | 'ACCOUNT_IDS',
      ][] = [
        ['k-000001', 'SYSTEM', 'ACCOUNT_IDS'],
        ['k-000002', 'MARKETING', 'ALL_USERS'],
        ['k-000003', 'SYSTEM', 'ALL_USERS'],
        ['k-000004', 'MARKETING', 'ACCOUNT_IDS'],
        ['k-000005', 'SYSTEM', 'ACCOUNT_IDS'],
      ];
      const ids: string[] = [];
      for (const [idempotencyKey, type, targetKind] of sends) {
        const r = await service.adminSendNotification(actor, {
          ...base,
          idempotencyKey,
          type,
          targetKind,
          accountIds: [user.id.toString()],
        });
        ids.push(r.broadcastId);
      }

      const page1 = await service.adminNotificationBroadcasts(actor, {
        limit: 2,
      });
      expect(page1.items.map((i) => i.id)).toEqual([ids[4], ids[3]]);
      expect(page1).toMatchObject({ totalCount: 5, hasMore: true });
      const page2 = await service.adminNotificationBroadcasts(actor, {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((i) => i.id)).toEqual([ids[2], ids[1]]);
      const page3 = await service.adminNotificationBroadcasts(actor, {
        limit: 2,
        cursor: page2.nextCursor!,
      });
      expect(page3).toMatchObject({ hasMore: false, nextCursor: null });
      expect(page3.items.map((i) => i.id)).toEqual([ids[0]]);

      const system = await service.adminNotificationBroadcasts(actor, {
        type: 'SYSTEM',
      });
      expect(system.items.map((i) => i.id)).toEqual([ids[4], ids[2], ids[0]]);
      expect(system.totalCount).toBe(3);
      const systemAccounts = await service.adminNotificationBroadcasts(actor, {
        type: 'SYSTEM',
        targetKind: 'ACCOUNT_IDS',
      });
      expect(systemAccounts.items.map((i) => i.id)).toEqual([ids[4], ids[0]]);
      expect(systemAccounts.totalCount).toBe(2);
      const allUsers = await service.adminNotificationBroadcasts(actor, {
        targetKind: 'ALL_USERS',
      });
      expect(allUsers.items.map((i) => i.id)).toEqual([ids[2], ids[1]]);
      expect(allUsers.items[0]).toMatchObject({
        targetAccountIds: [],
        skippedAccountIds: [],
      });
    });

    it.each(['abc', '-1', '1.5', '18446744073709551616'])(
      '반증: 커서 %p는 INVALID_CURSOR',
      async (cursor) => {
        const actor = await admin();
        await expect(
          service.adminNotificationBroadcasts(actor, { cursor }),
        ).rejects.toThrowDomain('INVALID_CURSOR');
      },
    );

    it.each([
      ['요청 직후', 'IN_PROGRESS', 0],
      ['30분 1ms 전', 'IN_PROGRESS', 30 * MINUTE - 1],
      ['정확히 30분', 'DELAYED', 30 * MINUTE],
      ['하루 뒤', 'DELAYED', 24 * 60 * MINUTE],
    ])('완료 기록이 없으면 %s는 %s다', async (_label, expected, elapsedMs) => {
      const actor = await admin();
      const user = await createAccount(prisma, { account_type: 'USER' });
      await service.adminSendNotification(actor, {
        ...input,
        accountIds: [user.id.toString()],
      });

      now = new Date(T0.getTime() + elapsedMs);
      const {
        items: [item],
      } = await service.adminNotificationBroadcasts(actor);
      expect(item).toMatchObject({
        status: expected,
        deliveredCount: 0,
        completedAt: null,
        requestedAt: T0,
      });
    });

    it('소비자가 끝내면 완료 시각·저장 수가 기록되고 30분이 지나도 COMPLETED다', async () => {
      const actor = await admin();
      const [a, b] = await Promise.all([
        createAccount(prisma, { account_type: 'USER' }),
        createAccount(prisma, { account_type: 'USER' }),
      ]);
      await service.adminSendNotification(actor, {
        ...input,
        accountIds: [a.id, b.id].map(String),
      });
      const done = new Date(T0.getTime() + 5_000);
      now = done;
      await drainOutbox(dispatcher);

      now = new Date(T0.getTime() + 60 * MINUTE);
      const {
        items: [item],
      } = await service.adminNotificationBroadcasts(actor);
      expect(item).toMatchObject({
        status: 'COMPLETED',
        deliveredCount: 2,
        targetCount: 2,
        completedAt: done,
      });
    });

    it('미완료 이력의 저장 수는 조회 때 알림을 세어 채운다(삭제된 알림 제외)', async () => {
      const actor = await admin();
      const users = await Promise.all([
        createAccount(prisma, { account_type: 'USER' }),
        createAccount(prisma, { account_type: 'USER' }),
        createAccount(prisma, { account_type: 'USER' }),
      ]);
      await service.adminSendNotification(actor, {
        ...input,
        accountIds: users.map((u) => u.id.toString()),
      });
      await drainOutbox(dispatcher);
      // 진행 중 상태 재현: 완료 기록을 지우고 알림 1건을 삭제 처리한다
      await prisma.notificationBroadcast.updateMany({
        data: { completed_at: null, delivered_count: null },
      });
      await prisma.notification.updateMany({
        where: { account_id: users[0].id },
        data: { deleted_at: T0 },
      });

      const {
        items: [item],
      } = await service.adminNotificationBroadcasts(actor);
      expect(item).toMatchObject({ status: 'IN_PROGRESS', deliveredCount: 2 });
    });
  });

  describe('발송 이력 단건', () => {
    const input = {
      ...base,
      targetKind: 'ACCOUNT_IDS' as const,
    };

    it('ID로 이력 1건을 목록과 같은 값으로 주고 목록 페이지 밖의 이력도 찾는다', async () => {
      const actor = await admin();
      const user = await createAccount(prisma, { account_type: 'USER' });
      const oldest = await service.adminSendNotification(actor, {
        ...input,
        idempotencyKey: 'detail-key-0',
        accountIds: [user.id.toString()],
      });
      await drainOutbox(dispatcher);
      await service.adminSendNotification(actor, {
        ...input,
        idempotencyKey: 'detail-key-1',
        accountIds: [user.id.toString()],
      });

      const firstPage = await service.adminNotificationBroadcasts(actor, {
        limit: 1,
      });
      expect(firstPage.items.map((i) => i.id)).not.toContain(
        oldest.broadcastId,
      );

      const detail = await service.adminNotificationBroadcast(
        actor,
        BigInt(oldest.broadcastId),
      );
      const {
        items: [listed],
      } = await service.adminNotificationBroadcasts(actor, {
        limit: 1,
        cursor: firstPage.nextCursor!,
      });
      expect(detail).toEqual(listed);
      expect(detail).toMatchObject({
        id: oldest.broadcastId,
        status: 'COMPLETED',
        deliveredCount: 1,
        targetAccountIds: [user.id.toString()],
      });
    });

    it('미완료 이력의 저장 수는 조회 때 알림을 세어 채운다', async () => {
      const actor = await admin();
      const users = await Promise.all([
        createAccount(prisma, { account_type: 'USER' }),
        createAccount(prisma, { account_type: 'USER' }),
      ]);
      const { broadcastId } = await service.adminSendNotification(actor, {
        ...input,
        accountIds: users.map((u) => u.id.toString()),
      });
      await drainOutbox(dispatcher);
      await prisma.notificationBroadcast.updateMany({
        data: { completed_at: null, delivered_count: null },
      });

      expect(
        await service.adminNotificationBroadcast(actor, BigInt(broadcastId)),
      ).toMatchObject({ status: 'IN_PROGRESS', deliveredCount: 2 });
    });

    it('없는 ID면 다른 이력이 있어도 null이다', async () => {
      const actor = await admin();
      const user = await createAccount(prisma, { account_type: 'USER' });
      const { broadcastId } = await service.adminSendNotification(actor, {
        ...input,
        accountIds: [user.id.toString()],
      });

      expect(
        await service.adminNotificationBroadcast(
          actor,
          BigInt(broadcastId) + 1n,
        ),
      ).toBeNull();
    });

    it('관리자가 아니면 거절한다', async () => {
      const actor = await admin();
      const user = await createAccount(prisma, { account_type: 'USER' });
      const { broadcastId } = await service.adminSendNotification(actor, {
        ...input,
        accountIds: [user.id.toString()],
      });

      await expect(
        service.adminNotificationBroadcast(user.id, BigInt(broadcastId)),
      ).rejects.toThrowDomain('ADMIN_ONLY');
    });
  });
});
