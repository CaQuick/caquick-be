import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';
import { RequestContextService } from '@/global/request-context';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, setupSellerWithStore } from '@/test/factories';
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

    it('malformed·overlong IP 는 컬럼에 쓰지 않고 null 로 저장한다 (insert 실패 방지)', async () => {
      const account = await createAccount(prisma);
      // ip_address VarChar(64) 초과 + 비정상 형식. trust proxy 가 넘길 수 있는 위험값.
      const overlong = `not-an-ip-${'x'.repeat(80)}`;

      await requestContext.run({ clientIp: overlong }, async () => {
        await repo.createAuditLog({
          actorAccountId: account.id,
          targetType: AuditTargetType.STORE,
          targetId: account.id,
          action: AuditActionType.UPDATE,
        });
      });

      const logs = await prisma.auditLog.findMany({
        where: { actor_account_id: account.id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].ip_address).toBeNull();
    });

    it('IPv6 client IP 도 유효하면 그대로 저장한다', async () => {
      const account = await createAccount(prisma);

      await requestContext.run({ clientIp: '2001:db8::1' }, async () => {
        await repo.createAuditLog({
          actorAccountId: account.id,
          targetType: AuditTargetType.STORE,
          targetId: account.id,
          action: AuditActionType.UPDATE,
        });
      });

      const logs = await prisma.auditLog.findMany({
        where: { actor_account_id: account.id },
      });
      expect(logs[0].ip_address).toBe('2001:db8::1');
    });
  });

  describe('createAuditLog(tx)', () => {
    const args = {
      actorAccountId: BigInt(1),
      targetType: 'ACCOUNT' as const,
      targetId: BigInt(2),
      action: 'CREATE' as const,
    };

    it('트랜잭션 클라이언트를 넘기면 그 트랜잭션에서 기록되고, 롤백 시 함께 사라진다', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await repo.createAuditLog(args, tx);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await prisma.auditLog.count()).toBe(0);

      await prisma.$transaction(async (tx) => {
        await repo.createAuditLog(args, tx);
      });
      expect(await prisma.auditLog.count()).toBe(1);
    });
  });

  describe('listAuditLogsBySeller', () => {
    async function createLog(
      args: Partial<{
        actorAccountId: bigint;
        storeId: bigint | null;
        targetType: 'STORE' | 'PRODUCT' | 'ORDER';
        targetId: bigint;
      }> = {},
    ) {
      const me = await setupSellerWithStore(prisma);
      return prisma.auditLog.create({
        data: {
          actor_account_id: args.actorAccountId ?? me.account.id,
          store_id: args.storeId === undefined ? me.store.id : args.storeId,
          target_type: args.targetType ?? 'STORE',
          target_id: args.targetId ?? me.store.id,
          action: 'UPDATE',
        },
      });
    }

    it('actor=본인 또는 storeId=본인 인 row 반환 (OR)', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);

      // 본인 actor
      const mineByActor = await prisma.auditLog.create({
        data: {
          actor_account_id: me.account.id,
          store_id: null,
          target_type: 'STORE',
          target_id: me.store.id,
          action: 'UPDATE',
        },
      });
      // 본인 store
      const mineByStore = await prisma.auditLog.create({
        data: {
          actor_account_id: other.account.id,
          store_id: me.store.id,
          target_type: 'STORE',
          target_id: me.store.id,
          action: 'UPDATE',
        },
      });
      // 다른 매장 (제외)
      await prisma.auditLog.create({
        data: {
          actor_account_id: other.account.id,
          store_id: other.store.id,
          target_type: 'STORE',
          target_id: other.store.id,
          action: 'UPDATE',
        },
      });

      const rows = await repo.listAuditLogsBySeller({
        sellerAccountId: me.account.id,
        storeId: me.store.id,
        limit: 100,
      });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(mineByActor.id);
      expect(ids).toContain(mineByStore.id);
      expect(rows).toHaveLength(2);
    });

    it('targetType 필터', async () => {
      await createLog({ targetType: 'STORE' });
      const orderLog = await createLog({ targetType: 'ORDER' });
      const filtered = await repo.listAuditLogsBySeller({
        sellerAccountId: orderLog.actor_account_id,
        storeId: orderLog.store_id!,
        limit: 100,
        targetType: 'ORDER',
      });
      expect(filtered.every((r) => r.target_type === 'ORDER')).toBe(true);
    });

    it('관리자 조작 대상 종류(ACCOUNT 등)는 매장 ID가 달려 있어도 제외한다', async () => {
      const me = await setupSellerWithStore(prisma);
      await prisma.auditLog.create({
        data: {
          actor_account_id: me.account.id,
          store_id: me.store.id,
          target_type: 'ACCOUNT',
          target_id: me.account.id,
          action: 'STATUS_CHANGE',
        },
      });
      const mine = await createLog({
        actorAccountId: me.account.id,
        storeId: me.store.id,
      });

      const rows = await repo.listAuditLogsBySeller({
        sellerAccountId: me.account.id,
        storeId: me.store.id,
        limit: 100,
      });

      expect(rows.map((r) => r.id)).toEqual([mine.id]);
    });

    it('cursor / limit', async () => {
      const me = await setupSellerWithStore(prisma);
      for (let i = 0; i < 3; i++) {
        await prisma.auditLog.create({
          data: {
            actor_account_id: me.account.id,
            store_id: me.store.id,
            target_type: 'STORE',
            target_id: me.store.id,
            action: 'UPDATE',
          },
        });
      }
      const first = await repo.listAuditLogsBySeller({
        sellerAccountId: me.account.id,
        storeId: me.store.id,
        limit: 1,
      });
      expect(first).toHaveLength(2);

      const paged = await repo.listAuditLogsBySeller({
        sellerAccountId: me.account.id,
        storeId: me.store.id,
        limit: 100,
        cursor: first[0].id,
      });
      expect(paged.every((r) => r.id < first[0].id)).toBe(true);
    });
  });
});
