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
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import {
  drainOutbox,
  OUTBOX_TEST_IMPORTS,
  outboxTestProviders,
} from '@/test/outbox';

describe('AdminNotificationService (real DB)', () => {
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
        ...outboxTestProviders(),
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

      expect(result).toEqual({ sentCount: 2, skippedAccountIds: [] });
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
});
