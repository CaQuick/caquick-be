import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerRepository (real DB)', () => {
  let repo: SellerRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [SellerRepository],
    });
    repo = module.get(SellerRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
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
