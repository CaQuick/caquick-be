import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminNotificationService } from '@/features/admin/services/admin-notification.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminNotificationService (real DB)', () => {
  let service: AdminNotificationService;
  let repo: AdminRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminNotificationService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminNotificationService);
    repo = module.get(AdminRepository);
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

  const base = {
    type: 'SYSTEM' as const,
    title: '  점검 안내  ',
    body: '오늘 밤 점검이 있습니다.',
  };

  describe('ACCOUNT_IDS', () => {
    it('활성 USER에게만 저장하고 나머지는 skippedAccountIds, 중복 ID는 한 번, 감사 1건', async () => {
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
      const rows = await prisma.notification.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        account_id: user.id,
        type: 'SYSTEM',
        title: '점검 안내',
        body: base.body,
        event: null,
      });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'NOTIFICATION', actor_account_id: actor },
      });
      expect(audit.after_json).toMatchObject({
        type: 'SYSTEM',
        targetKind: 'ACCOUNT_IDS',
        sentCount: 1,
        skippedCount: 4,
        interrupted: false,
      });
    });
  });

  describe('ALL_USERS', () => {
    it('활성 USER 전체에 보내고 SELLER·ADMIN·정지·탈퇴는 제외한다', async () => {
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
      const rows = await prisma.notification.findMany({
        orderBy: { account_id: 'asc' },
      });
      expect(rows.map((r) => r.account_id)).toEqual(
        users.map((u) => u.id).sort((a, b) => (a < b ? -1 : 1)),
      );
      expect(rows.every((r) => r.type === 'MARKETING')).toBe(true);
    });

    it('청크(1,000) 경계를 넘어도 빠짐없이 한 번씩 보낸다', async () => {
      const actor = await admin();
      await prisma.account.createMany({
        data: Array.from({ length: 1_050 }, (_, i) => ({
          account_type: 'USER' as const,
          status: 'ACTIVE' as const,
          email: `bulk${i}@example.com`,
        })),
      });

      const result = await service.adminSendNotification(actor, {
        ...base,
        targetKind: 'ALL_USERS',
      });

      expect(result.sentCount).toBe(1_050);
      expect(await prisma.notification.count()).toBe(1_050);
      const dup = await prisma.notification.groupBy({
        by: ['account_id'],
        _count: { _all: true },
        having: { account_id: { _count: { gt: 1 } } },
      });
      expect(dup).toHaveLength(0);
    });

    // 앞 청크는 커밋된 채 남는다 — 조용히 실패하면 재시도가 중복 발송이 되므로 건수를 감사에 남기고 알린다
    it('청크 사이에 실패하면 저장된 건수를 감사(interrupted)에 남기고 500', async () => {
      const actor = await admin();
      await prisma.account.createMany({
        data: Array.from({ length: 1_050 }, (_, i) => ({
          account_type: 'USER' as const,
          status: 'ACTIVE' as const,
          email: `bulk${i}@example.com`,
        })),
      });
      const original = repo.createNotifications.bind(repo);
      const spy = jest
        .spyOn(repo, 'createNotifications')
        .mockImplementationOnce(original)
        .mockRejectedValueOnce(new Error('boom'));

      try {
        await expect(
          service.adminSendNotification(actor, {
            ...base,
            targetKind: 'ALL_USERS',
          }),
        ).rejects.toThrowDomain(500);
      } finally {
        spy.mockRestore();
      }

      expect(await prisma.notification.count()).toBe(1_000);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'NOTIFICATION', actor_account_id: actor },
      });
      expect(audit.after_json).toMatchObject({
        sentCount: 1_000,
        interrupted: true,
      });
    });
  });
});
