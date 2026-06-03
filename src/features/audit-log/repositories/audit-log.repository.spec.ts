import type { PrismaClient } from '@prisma/client';
import { AuditActionType, AuditTargetType } from '@prisma/client';

import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { RequestContextService } from '@/global/request-context';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AuditLogRepository (real DB)', () => {
  let repo: AuditLogRepository;
  let requestContext: RequestContextService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [AuditLogRepository],
    });
    repo = module.get(AuditLogRepository);
    requestContext = module.get(RequestContextService);
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

    it('ipAddress/userAgent 를 명시하지 않으면 요청 컨텍스트(ALS)에서 보강한다', async () => {
      const account = await createAccount(prisma);

      await requestContext.run(
        { clientIp: '203.0.113.7', userAgent: 'ctx-agent' },
        async () => {
          await repo.createAuditLog({
            actorAccountId: account.id,
            targetType: AuditTargetType.STORE,
            targetId: account.id,
            action: AuditActionType.UPDATE,
          });
        },
      );

      const logs = await prisma.auditLog.findMany({
        where: { actor_account_id: account.id },
      });
      expect(logs[0].ip_address).toBe('203.0.113.7');
      expect(logs[0].user_agent).toBe('ctx-agent');
    });

    it('명시된 ipAddress/userAgent 가 요청 컨텍스트보다 우선한다', async () => {
      const account = await createAccount(prisma);

      await requestContext.run(
        { clientIp: '203.0.113.7', userAgent: 'ctx-agent' },
        async () => {
          await repo.createAuditLog({
            actorAccountId: account.id,
            targetType: AuditTargetType.STORE,
            targetId: account.id,
            action: AuditActionType.UPDATE,
            ipAddress: '10.0.0.1',
            userAgent: 'explicit-agent',
          });
        },
      );

      const logs = await prisma.auditLog.findMany({
        where: { actor_account_id: account.id },
      });
      expect(logs[0].ip_address).toBe('10.0.0.1');
      expect(logs[0].user_agent).toBe('explicit-agent');
    });

    it('요청 컨텍스트 밖에서는 ip/ua 가 null 로 저장된다', async () => {
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
      expect(logs[0].ip_address).toBeNull();
      expect(logs[0].user_agent).toBeNull();
    });
  });
});
