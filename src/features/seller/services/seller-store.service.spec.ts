import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerStoreService } from '@/features/seller/services/seller-store.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerStoreService (real DB)', () => {
  let service: SellerStoreService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [SellerStoreService, SellerRepository],
    });
    service = module.get(SellerStoreService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('requireSellerContext (공통)', () => {
    it('판매자 계정이 아니면 ForbiddenException', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(service.sellerMyStore(account.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('SELLER인데 store가 없으면 NotFoundException', async () => {
      const account = await createAccount(prisma, { account_type: 'SELLER' });
      await expect(service.sellerMyStore(account.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('sellerMyStore', () => {
    it('SELLER + store가 있으면 매장 DTO를 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma, {
        storeName: '카퀵 베이커리',
      });

      const result = await service.sellerMyStore(account.id);

      expect(result.id).toBe(store.id.toString());
      expect(result.storeName).toBe('카퀵 베이커리');
      expect(result.sellerAccountId).toBe(account.id.toString());
    });
  });

  describe('sellerStoreBusinessHours', () => {
    it('영업시간 row가 없으면 빈 배열', async () => {
      const { account } = await setupSellerWithStore(prisma);
      const result = await service.sellerStoreBusinessHours(account.id);
      expect(result).toEqual([]);
    });

    it('day_of_week 오름차순으로 영업시간을 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await prisma.storeBusinessHour.createMany({
        data: [
          { store_id: store.id, day_of_week: 1, is_closed: false },
          { store_id: store.id, day_of_week: 0, is_closed: true },
        ],
      });

      const result = await service.sellerStoreBusinessHours(account.id);

      expect(result).toHaveLength(2);
      expect(result[0].dayOfWeek).toBe(0);
      expect(result[0].isClosed).toBe(true);
      expect(result[1].dayOfWeek).toBe(1);
      expect(result[1].isClosed).toBe(false);
    });
  });

  describe('sellerStoreSpecialClosures', () => {
    it('특별 휴무 목록을 cursor 페이지네이션으로 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await prisma.storeSpecialClosure.create({
        data: {
          store_id: store.id,
          closure_date: new Date('2026-04-01'),
          reason: '정기 휴무',
        },
      });

      const result = await service.sellerStoreSpecialClosures(account.id);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].reason).toBe('정기 휴무');
      expect(result.nextCursor).toBeNull();
    });

    it('limit 초과 시 nextCursor를 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      for (let i = 1; i <= 3; i++) {
        await prisma.storeSpecialClosure.create({
          data: {
            store_id: store.id,
            closure_date: new Date(`2026-04-0${i}`),
          },
        });
      }

      const result = await service.sellerStoreSpecialClosures(account.id, {
        limit: 2,
      });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
    });
  });

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
  });

  describe('sellerUpdateStoreBasicInfo', () => {
    it('storeName/storePhone을 수정하고 audit log를 생성한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);

      const result = await service.sellerUpdateStoreBasicInfo(account.id, {
        storeName: '새 매장명',
        storePhone: '02-9999-8888',
      });

      expect(result.storeName).toBe('새 매장명');
      expect(result.storePhone).toBe('02-9999-8888');

      const dbStore = await prisma.store.findUniqueOrThrow({
        where: { id: store.id },
      });
      expect(dbStore.store_name).toBe('새 매장명');

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: store.id },
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('UPDATE');
      expect(auditLogs[0].target_type).toBe('STORE');
    });
  });

  describe('sellerUpsertStoreBusinessHour', () => {
    it('dayOfWeek가 0~6 범위 밖이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpsertStoreBusinessHour(account.id, {
          dayOfWeek: 7,
          isClosed: false,
          openTime: new Date('1970-01-01T09:00:00Z'),
          closeTime: new Date('1970-01-01T18:00:00Z'),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('영업일인데 시간이 없으면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpsertStoreBusinessHour(account.id, {
          dayOfWeek: 1,
          isClosed: false,
          openTime: null,
          closeTime: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('open >= close면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpsertStoreBusinessHour(account.id, {
          dayOfWeek: 1,
          isClosed: false,
          openTime: new Date('1970-01-01T18:00:00Z'),
          closeTime: new Date('1970-01-01T09:00:00Z'),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 영업일 upsert는 row를 생성하고 다시 호출하면 같은 row를 갱신한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const created = await service.sellerUpsertStoreBusinessHour(account.id, {
        dayOfWeek: 1,
        isClosed: false,
        openTime: new Date('1970-01-01T09:00:00Z'),
        closeTime: new Date('1970-01-01T18:00:00Z'),
      });
      expect(created.dayOfWeek).toBe(1);
      expect(created.isClosed).toBe(false);

      // 같은 dayOfWeek로 다시 호출 → upsert로 같은 id 갱신
      const updated = await service.sellerUpsertStoreBusinessHour(account.id, {
        dayOfWeek: 1,
        isClosed: false,
        openTime: new Date('1970-01-01T10:00:00Z'),
        closeTime: new Date('1970-01-01T20:00:00Z'),
      });
      expect(updated.id).toBe(created.id);

      const rows = await prisma.storeBusinessHour.findMany({
        where: { store_id: store.id },
      });
      expect(rows).toHaveLength(1);
    });

    it('휴무일 upsert는 시간을 null로 저장한다', async () => {
      const { account } = await setupSellerWithStore(prisma);
      const result = await service.sellerUpsertStoreBusinessHour(account.id, {
        dayOfWeek: 0,
        isClosed: true,
        openTime: new Date('1970-01-01T09:00:00Z'),
        closeTime: new Date('1970-01-01T18:00:00Z'),
      });
      expect(result.isClosed).toBe(true);
      expect(result.openTime).toBeNull();
      expect(result.closeTime).toBeNull();
    });
  });

  describe('sellerUpsertStoreSpecialClosure', () => {
    it('closureId를 줬는데 없으면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpsertStoreSpecialClosure(account.id, {
          closureId: '999999',
          closureDate: new Date('2026-04-01'),
          reason: null,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('closureId 없으면 신규 생성', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const result = await service.sellerUpsertStoreSpecialClosure(account.id, {
        closureDate: new Date('2026-04-01'),
        reason: '정기 휴무',
      });
      expect(result.reason).toBe('정기 휴무');

      const rows = await prisma.storeSpecialClosure.findMany({
        where: { store_id: store.id },
      });
      expect(rows).toHaveLength(1);
    });

    it('closureId가 있으면 update 경로로 갱신', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const created = await prisma.storeSpecialClosure.create({
        data: {
          store_id: store.id,
          closure_date: new Date('2026-04-01'),
          reason: '구 사유',
        },
      });

      const result = await service.sellerUpsertStoreSpecialClosure(account.id, {
        closureId: created.id.toString(),
        closureDate: new Date('2026-04-02'),
        reason: '신 사유',
      });

      expect(result.id).toBe(created.id.toString());
      expect(result.reason).toBe('신 사유');
    });
  });

  describe('sellerDeleteStoreSpecialClosure', () => {
    it('존재하지 않는 closureId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerDeleteStoreSpecialClosure(account.id, BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('soft-delete + audit log 생성', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const closure = await prisma.storeSpecialClosure.create({
        data: { store_id: store.id, closure_date: new Date('2026-04-01') },
      });

      const result = await service.sellerDeleteStoreSpecialClosure(
        account.id,
        closure.id,
      );
      expect(result).toBe(true);

      const after = await prisma.storeSpecialClosure.findUnique({
        where: { id: closure.id },
      });
      expect(after?.deleted_at).not.toBeNull();

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: store.id, action: 'DELETE' },
      });
      expect(auditLogs).toHaveLength(1);
    });
  });

  describe('sellerUpdatePickupPolicy', () => {
    it('pickupSlotIntervalMinutes 범위 밖이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpdatePickupPolicy(account.id, {
          pickupSlotIntervalMinutes: 4, // < min 5
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
