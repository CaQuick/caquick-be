import type { PrismaClient } from '@prisma/client';
import { AuditActionType, AuditTargetType } from '@prisma/client';

import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AuditLogRepository (real DB)', () => {
  let repo: AuditLogRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [AuditLogRepository],
    });
    repo = module.get(AuditLogRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('createAuditLog', () => {
    it('감사 로그를 생성한다', async () => {
      const account = await createAccount(prisma);

      await repo.createAuditLog({
        actorAccountId: account.id,
        targetType: AuditTargetType.CHANGE_PASSWORD,
        targetId: account.id,
        action: AuditActionType.UPDATE,
        beforeJson: null,
        afterJson: { changed: true },
        ipAddress: '1.2.3.4',
        userAgent: 'test',
      });

      const logs = await prisma.auditLog.findMany({
        where: { actor_account_id: account.id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe(AuditActionType.UPDATE);
    });

    it('storeId/ipAddress/userAgent/beforeJson 모두 생략해도 기본 null 처리로 생성된다', async () => {
      const account = await createAccount(prisma);

      await repo.createAuditLog({
        actorAccountId: account.id,
        targetType: AuditTargetType.STORE,
        targetId: account.id,
        action: AuditActionType.UPDATE,
      });

      const logs = await prisma.auditLog.findMany({
        where: { actor_account_id: account.id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].store_id).toBeNull();
      expect(logs[0].ip_address).toBeNull();
      expect(logs[0].user_agent).toBeNull();
      expect(logs[0].before_json).toBeNull();
      expect(logs[0].after_json).toBeNull();
    });

    it('storeId를 명시하면 해당 값으로 저장된다', async () => {
      const account = await createAccount(prisma);
      const storeId = BigInt(42);

      await repo.createAuditLog({
        actorAccountId: account.id,
        storeId,
        targetType: AuditTargetType.STORE,
        targetId: account.id,
        action: AuditActionType.UPDATE,
      });

      const logs = await prisma.auditLog.findMany({
        where: { actor_account_id: account.id },
      });
      expect(logs[0].store_id).toBe(storeId);
    });
  });
});
