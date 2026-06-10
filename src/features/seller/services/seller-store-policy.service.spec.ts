import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerStorePolicyService } from '@/features/seller/services/seller-store-policy.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerStorePolicyService (real DB)', () => {
  let service: SellerStorePolicyService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerStorePolicyService,
        SellerRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerStorePolicyService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupSellerWithoutStore() {
    const account = await prisma.account.create({
      data: {
        account_type: 'SELLER',
        email: `no-store-${Date.now()}-${Math.random()}@example.com`,
        name: 'no-store-seller',
      },
    });
    await prisma.sellerProfile.create({
      data: {
        account_id: account.id,
        business_name: 'no-store',
        business_phone: '02-0000-9999',
      },
    });
    return account;
  }

  describe('sellerStoreDailyCapacities', () => {
    it('일별 용량 목록과 fromDate/toDate 필터가 동작한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await prisma.storeDailyCapacity.createMany({
        data: [
          {
            store_id: store.id,
            capacity_date: new Date('2026-03-30'),
            capacity: 50,
          },
          {
            store_id: store.id,
            capacity_date: new Date('2026-04-15'),
            capacity: 100,
          },
        ],
      });

      const result = await service.sellerStoreDailyCapacities(account.id, {
        fromDate: new Date('2026-04-01'),
        toDate: new Date('2026-04-30'),
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].capacity).toBe(100);
    });

    it('cursor 페이지네이션이 동작한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      for (let i = 1; i <= 3; i++) {
        await prisma.storeDailyCapacity.create({
          data: {
            store_id: store.id,
            capacity_date: new Date(`2026-05-0${i}`),
            capacity: 10 * i,
          },
        });
      }
      const first = await service.sellerStoreDailyCapacities(account.id, {
        limit: 2,
      });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = await service.sellerStoreDailyCapacities(account.id, {
        limit: 2,
        cursor: first.nextCursor as string,
      });
      expect(second.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('sellerUpdatePickupPolicy', () => {
    it('pickupSlotIntervalMinutes 범위 밖이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpdatePickupPolicy(account.id, {
          pickupSlotIntervalMinutes: 4,
          minLeadTimeMinutes: 60,
          maxDaysAhead: 7,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('minLeadTimeMinutes 범위 밖이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpdatePickupPolicy(account.id, {
          pickupSlotIntervalMinutes: 30,
          minLeadTimeMinutes: -1,
          maxDaysAhead: 7,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('maxDaysAhead 범위 밖이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpdatePickupPolicy(account.id, {
          pickupSlotIntervalMinutes: 30,
          minLeadTimeMinutes: 60,
          maxDaysAhead: 366,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 수정 시 매장 정보 갱신 + audit log(before/after)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);

      const result = await service.sellerUpdatePickupPolicy(account.id, {
        pickupSlotIntervalMinutes: 15,
        minLeadTimeMinutes: 30,
        maxDaysAhead: 14,
      });

      expect(result.pickupSlotIntervalMinutes).toBe(15);
      expect(result.minLeadTimeMinutes).toBe(30);
      expect(result.maxDaysAhead).toBe(14);

      const dbStore = await prisma.store.findUniqueOrThrow({
        where: { id: store.id },
      });
      expect(dbStore.pickup_slot_interval_minutes).toBe(15);

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: store.id },
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('UPDATE');
      expect(auditLogs[0].before_json).not.toBeNull();
      expect(auditLogs[0].after_json).not.toBeNull();
    });

    it('store가 없으면 NotFoundException', async () => {
      const account = await setupSellerWithoutStore();
      await expect(
        service.sellerUpdatePickupPolicy(account.id, {
          pickupSlotIntervalMinutes: 30,
          minLeadTimeMinutes: 60,
          maxDaysAhead: 7,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerUpsertStoreDailyCapacity', () => {
    it('capacityId가 없으면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpsertStoreDailyCapacity(account.id, {
          capacityId: '999999',
          capacityDate: new Date('2026-04-01'),
          capacity: 100,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('capacity 범위 밖이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpsertStoreDailyCapacity(account.id, {
          capacityDate: new Date('2026-04-01'),
          capacity: 5001,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('capacityId 없으면 신규 생성', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const result = await service.sellerUpsertStoreDailyCapacity(account.id, {
        capacityDate: new Date('2026-04-01'),
        capacity: 100,
      });
      expect(result.capacity).toBe(100);

      const rows = await prisma.storeDailyCapacity.findMany({
        where: { store_id: store.id },
      });
      expect(rows).toHaveLength(1);
    });

    it('capacityId가 있으면 update 경로로 갱신', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const created = await prisma.storeDailyCapacity.create({
        data: {
          store_id: store.id,
          capacity_date: new Date('2026-04-01'),
          capacity: 100,
        },
      });

      const result = await service.sellerUpsertStoreDailyCapacity(account.id, {
        capacityId: created.id.toString(),
        capacityDate: new Date('2026-04-02'),
        capacity: 200,
      });
      expect(result.id).toBe(created.id.toString());
      expect(result.capacity).toBe(200);
    });
  });

  describe('sellerDeleteStoreDailyCapacity', () => {
    it('존재하지 않는 capacityId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerDeleteStoreDailyCapacity(account.id, BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('soft-delete + audit log(beforeJson 포함)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const capacity = await prisma.storeDailyCapacity.create({
        data: {
          store_id: store.id,
          capacity_date: new Date('2026-04-01'),
          capacity: 100,
        },
      });

      const result = await service.sellerDeleteStoreDailyCapacity(
        account.id,
        capacity.id,
      );
      expect(result).toBe(true);

      const after = await prisma.storeDailyCapacity.findUnique({
        where: { id: capacity.id },
      });
      expect(after?.deleted_at).not.toBeNull();

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: store.id, action: 'DELETE' },
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].before_json).not.toBeNull();
    });
  });
});
