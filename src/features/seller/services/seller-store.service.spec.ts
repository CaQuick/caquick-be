import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditActionType, AuditTargetType, Prisma } from '@prisma/client';

import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerStoreService } from '@/features/seller/services/seller-store.service';

const SELLER_CONTEXT = {
  id: BigInt(1),
  account_type: 'SELLER',
  status: 'ACTIVE',
  store: { id: BigInt(100) },
};

const NON_SELLER_CONTEXT = {
  id: BigInt(1),
  account_type: 'USER',
  status: 'ACTIVE',
  store: { id: BigInt(100) },
};

const NO_STORE_CONTEXT = {
  id: BigInt(1),
  account_type: 'SELLER',
  status: 'ACTIVE',
  store: null,
};

const NOW = new Date('2026-03-30T12:00:00Z');

const STORE_ROW = {
  id: BigInt(100),
  seller_account_id: BigInt(1),
  store_name: '카퀵 베이커리',
  store_phone: '02-1234-5678',
  address_full: '서울시 강남구 역삼동 123-45',
  address_city: '서울시',
  address_district: '강남구',
  address_neighborhood: '역삼동',
  latitude: new Prisma.Decimal('37.4979'),
  longitude: new Prisma.Decimal('127.0276'),
  map_provider: 'NAVER' as const,
  website_url: 'https://caquick.kr',
  business_hours_text: '매일 09:00~18:00',
  pickup_slot_interval_minutes: 30,
  min_lead_time_minutes: 60,
  max_days_ahead: 7,
  is_active: true,
  created_at: NOW,
  updated_at: NOW,
};

describe('SellerStoreService', () => {
  let service: SellerStoreService;
  let repo: jest.Mocked<SellerRepository>;

  beforeEach(async () => {
    repo = {
      findSellerAccountContext: jest.fn(),
      createAuditLog: jest.fn(),
      findStoreBySellerAccountId: jest.fn(),
      listStoreBusinessHours: jest.fn(),
      upsertStoreBusinessHour: jest.fn(),
      listStoreSpecialClosures: jest.fn(),
      findStoreSpecialClosureById: jest.fn(),
      createStoreSpecialClosure: jest.fn(),
      updateStoreSpecialClosure: jest.fn(),
      softDeleteStoreSpecialClosure: jest.fn(),
      updateStore: jest.fn(),
      listStoreDailyCapacities: jest.fn(),
      findStoreDailyCapacityById: jest.fn(),
      createStoreDailyCapacity: jest.fn(),
      updateStoreDailyCapacity: jest.fn(),
      softDeleteStoreDailyCapacity: jest.fn(),
    } as unknown as jest.Mocked<SellerRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerStoreService,
        {
          provide: SellerRepository,
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get<SellerStoreService>(SellerStoreService);
  });

  // ─── 공통 컨텍스트 검증 ───

  describe('requireSellerContext', () => {
    it('판매자 계정이 아니면 ForbiddenException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(
        NON_SELLER_CONTEXT as never,
      );

      await expect(service.sellerMyStore(BigInt(1))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('매장이 없는 판매자 계정이면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(
        NO_STORE_CONTEXT as never,
      );

      await expect(service.sellerMyStore(BigInt(1))).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── sellerMyStore ───

  describe('sellerMyStore', () => {
    it('매장 정보가 DB에 없으면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      repo.findStoreBySellerAccountId.mockResolvedValue(null as never);

      await expect(service.sellerMyStore(BigInt(1))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('정상 조회 시 매장 정보를 변환하여 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      repo.findStoreBySellerAccountId.mockResolvedValue(STORE_ROW as never);

      const result = await service.sellerMyStore(BigInt(1));

      expect(result.id).toBe('100');
      expect(result.sellerAccountId).toBe('1');
      expect(result.storeName).toBe('카퀵 베이커리');
      expect(result.storePhone).toBe('02-1234-5678');
      expect(result.addressFull).toBe('서울시 강남구 역삼동 123-45');
      expect(result.addressCity).toBe('서울시');
      expect(result.latitude).toBe('37.4979');
      expect(result.longitude).toBe('127.0276');
      expect(result.mapProvider).toBe('NAVER');
      expect(result.isActive).toBe(true);
      expect(repo.findStoreBySellerAccountId).toHaveBeenCalledWith(BigInt(1));
    });
  });

  // ─── sellerStoreBusinessHours ───

  describe('sellerStoreBusinessHours', () => {
    it('정상 조회 시 영업시간 목록을 변환하여 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      const rows = [
        {
          id: BigInt(1),
          day_of_week: 0,
          is_closed: true,
          open_time: null,
          close_time: null,
          created_at: NOW,
          updated_at: NOW,
        },
        {
          id: BigInt(2),
          day_of_week: 1,
          is_closed: false,
          open_time: new Date('1970-01-01T09:00:00Z'),
          close_time: new Date('1970-01-01T18:00:00Z'),
          created_at: NOW,
          updated_at: NOW,
        },
      ];
      repo.listStoreBusinessHours.mockResolvedValue(rows as never);

      const result = await service.sellerStoreBusinessHours(BigInt(1));

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[0].dayOfWeek).toBe(0);
      expect(result[0].isClosed).toBe(true);
      expect(result[0].openTime).toBeNull();
      expect(result[1].id).toBe('2');
      expect(result[1].dayOfWeek).toBe(1);
      expect(result[1].isClosed).toBe(false);
      expect(result[1].openTime).toEqual(new Date('1970-01-01T09:00:00Z'));
      expect(result[1].closeTime).toEqual(new Date('1970-01-01T18:00:00Z'));
      expect(repo.listStoreBusinessHours).toHaveBeenCalledWith(BigInt(100));
    });
  });

  // ─── sellerStoreSpecialClosures ───

  describe('sellerStoreSpecialClosures', () => {
    it('정상 조회 시 특별 휴무 목록과 nextCursor를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      const rows = [
        {
          id: BigInt(10),
          closure_date: new Date('2026-04-01'),
          reason: '정기 휴무',
          created_at: NOW,
          updated_at: NOW,
        },
      ];
      repo.listStoreSpecialClosures.mockResolvedValue(rows as never);

      const result = await service.sellerStoreSpecialClosures(BigInt(1));

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('10');
      expect(result.items[0].closureDate).toEqual(new Date('2026-04-01'));
      expect(result.items[0].reason).toBe('정기 휴무');
      expect(result.nextCursor).toBeNull();
      expect(repo.listStoreSpecialClosures).toHaveBeenCalledWith(
        expect.objectContaining({ storeId: BigInt(100) }),
      );
    });

    it('cursor와 limit을 전달하면 정규화된 값으로 repository를 호출해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      repo.listStoreSpecialClosures.mockResolvedValue([] as never);

      await service.sellerStoreSpecialClosures(BigInt(1), {
        limit: 5,
        cursor: '50',
      });

      expect(repo.listStoreSpecialClosures).toHaveBeenCalledWith({
        storeId: BigInt(100),
        limit: 5,
        cursor: BigInt(50),
      });
    });
  });

  // ─── sellerStoreDailyCapacities ───

  describe('sellerStoreDailyCapacities', () => {
    it('정상 조회 시 일별 용량 목록과 nextCursor를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      const rows = [
        {
          id: BigInt(20),
          capacity_date: new Date('2026-04-01'),
          capacity: 100,
          created_at: NOW,
          updated_at: NOW,
        },
        {
          id: BigInt(21),
          capacity_date: new Date('2026-04-02'),
          capacity: 150,
          created_at: NOW,
          updated_at: NOW,
        },
      ];
      repo.listStoreDailyCapacities.mockResolvedValue(rows as never);

      const result = await service.sellerStoreDailyCapacities(BigInt(1));

      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('20');
      expect(result.items[0].capacityDate).toEqual(new Date('2026-04-01'));
      expect(result.items[0].capacity).toBe(100);
      expect(result.items[1].id).toBe('21');
      expect(result.items[1].capacity).toBe(150);
      expect(result.nextCursor).toBeNull();
      expect(repo.listStoreDailyCapacities).toHaveBeenCalledWith(
        expect.objectContaining({ storeId: BigInt(100) }),
      );
    });

    it('fromDate/toDate 필터를 전달하면 repository에 전달해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      repo.listStoreDailyCapacities.mockResolvedValue([] as never);

      await service.sellerStoreDailyCapacities(BigInt(1), {
        limit: 10,
        cursor: '30',
        fromDate: new Date('2026-04-01'),
        toDate: new Date('2026-04-30'),
      });

      expect(repo.listStoreDailyCapacities).toHaveBeenCalledWith({
        storeId: BigInt(100),
        limit: 10,
        cursor: BigInt(30),
        fromDate: new Date('2026-04-01'),
        toDate: new Date('2026-04-30'),
      });
    });
  });

  // ─── sellerUpdateStoreBasicInfo ───

  describe('sellerUpdateStoreBasicInfo', () => {
    it('정상 수정 시 업데이트된 매장 정보를 반환하고 감사 로그를 생성해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      repo.findStoreBySellerAccountId.mockResolvedValue(STORE_ROW as never);
      const updatedRow = {
        ...STORE_ROW,
        store_name: '새 매장명',
        store_phone: '02-9999-8888',
        updated_at: new Date('2026-03-30T13:00:00Z'),
      };
      repo.updateStore.mockResolvedValue(updatedRow as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerUpdateStoreBasicInfo(BigInt(1), {
        storeName: '새 매장명',
        storePhone: '02-9999-8888',
      });

      expect(result.id).toBe('100');
      expect(result.storeName).toBe('새 매장명');
      expect(result.storePhone).toBe('02-9999-8888');
      expect(repo.updateStore).toHaveBeenCalledWith({
        storeId: BigInt(100),
        data: expect.objectContaining({
          store_name: '새 매장명',
          store_phone: '02-9999-8888',
        }),
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.STORE,
          targetId: BigInt(100),
          action: AuditActionType.UPDATE,
        }),
      );
    });

    it('매장 정보가 없으면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      repo.findStoreBySellerAccountId.mockResolvedValue(null as never);

      await expect(
        service.sellerUpdateStoreBasicInfo(BigInt(1), {
          storeName: '새 매장명',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── sellerUpsertStoreBusinessHour ───

  describe('sellerUpsertStoreBusinessHour', () => {
    beforeEach(() => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
    });

    it('dayOfWeek가 0 미만이면 BadRequestException을 던져야 한다', async () => {
      await expect(
        service.sellerUpsertStoreBusinessHour(BigInt(1), {
          dayOfWeek: -1,
          isClosed: false,
          openTime: new Date('1970-01-01T09:00:00Z'),
          closeTime: new Date('1970-01-01T18:00:00Z'),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('dayOfWeek가 6 초과이면 BadRequestException을 던져야 한다', async () => {
      await expect(
        service.sellerUpsertStoreBusinessHour(BigInt(1), {
          dayOfWeek: 7,
          isClosed: false,
          openTime: new Date('1970-01-01T09:00:00Z'),
          closeTime: new Date('1970-01-01T18:00:00Z'),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('영업일인데 openTime/closeTime이 없으면 BadRequestException을 던져야 한다', async () => {
      await expect(
        service.sellerUpsertStoreBusinessHour(BigInt(1), {
          dayOfWeek: 1,
          isClosed: false,
          openTime: null,
          closeTime: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('openTime이 closeTime보다 크거나 같으면 BadRequestException을 던져야 한다', async () => {
      await expect(
        service.sellerUpsertStoreBusinessHour(BigInt(1), {
          dayOfWeek: 1,
          isClosed: false,
          openTime: new Date('1970-01-01T18:00:00Z'),
          closeTime: new Date('1970-01-01T09:00:00Z'),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 영업일 upsert 시 영업시간을 반환하고 감사 로그를 생성해야 한다', async () => {
      const bhRow = {
        id: BigInt(5),
        day_of_week: 1,
        is_closed: false,
        open_time: new Date('1970-01-01T09:00:00Z'),
        close_time: new Date('1970-01-01T18:00:00Z'),
        created_at: NOW,
        updated_at: NOW,
      };
      repo.upsertStoreBusinessHour.mockResolvedValue(bhRow as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerUpsertStoreBusinessHour(BigInt(1), {
        dayOfWeek: 1,
        isClosed: false,
        openTime: new Date('1970-01-01T09:00:00Z'),
        closeTime: new Date('1970-01-01T18:00:00Z'),
      });

      expect(result.id).toBe('5');
      expect(result.dayOfWeek).toBe(1);
      expect(result.isClosed).toBe(false);
      expect(result.openTime).toEqual(new Date('1970-01-01T09:00:00Z'));
      expect(result.closeTime).toEqual(new Date('1970-01-01T18:00:00Z'));
      expect(repo.upsertStoreBusinessHour).toHaveBeenCalledWith({
        storeId: BigInt(100),
        dayOfWeek: 1,
        isClosed: false,
        openTime: new Date('1970-01-01T09:00:00Z'),
        closeTime: new Date('1970-01-01T18:00:00Z'),
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.STORE,
          action: AuditActionType.UPDATE,
        }),
      );
    });

    it('휴무일 upsert 시 openTime/closeTime을 null로 저장해야 한다', async () => {
      const bhRow = {
        id: BigInt(6),
        day_of_week: 0,
        is_closed: true,
        open_time: null,
        close_time: null,
        created_at: NOW,
        updated_at: NOW,
      };
      repo.upsertStoreBusinessHour.mockResolvedValue(bhRow as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerUpsertStoreBusinessHour(BigInt(1), {
        dayOfWeek: 0,
        isClosed: true,
        openTime: new Date('1970-01-01T09:00:00Z'),
        closeTime: new Date('1970-01-01T18:00:00Z'),
      });

      expect(result.isClosed).toBe(true);
      expect(result.openTime).toBeNull();
      expect(repo.upsertStoreBusinessHour).toHaveBeenCalledWith(
        expect.objectContaining({
          isClosed: true,
          openTime: null,
          closeTime: null,
        }),
      );
    });
  });

  // ─── sellerUpsertStoreSpecialClosure ───

  describe('sellerUpsertStoreSpecialClosure', () => {
    beforeEach(() => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
    });

    it('closureId가 주어졌으나 조회되지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findStoreSpecialClosureById.mockResolvedValue(null as never);

      await expect(
        service.sellerUpsertStoreSpecialClosure(BigInt(1), {
          closureId: '999',
          closureDate: new Date('2026-04-01'),
          reason: null,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('closureId가 없으면 create 경로를 타야 한다', async () => {
      const closureRow = {
        id: BigInt(10),
        closure_date: new Date('2026-04-01'),
        reason: '정기 휴무',
        created_at: new Date(),
        updated_at: new Date(),
      };
      repo.createStoreSpecialClosure.mockResolvedValue(closureRow as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerUpsertStoreSpecialClosure(BigInt(1), {
        closureDate: new Date('2026-04-01'),
        reason: '정기 휴무',
      });

      expect(result.id).toBe('10');
      expect(repo.createStoreSpecialClosure).toHaveBeenCalled();
      expect(repo.updateStoreSpecialClosure).not.toHaveBeenCalled();
    });

    it('closureId가 있으면 update 경로를 타야 한다', async () => {
      repo.findStoreSpecialClosureById.mockResolvedValue({
        id: BigInt(10),
      } as never);
      const closureRow = {
        id: BigInt(10),
        closure_date: new Date('2026-04-02'),
        reason: '변경된 사유',
        created_at: new Date(),
        updated_at: new Date(),
      };
      repo.updateStoreSpecialClosure.mockResolvedValue(closureRow as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerUpsertStoreSpecialClosure(BigInt(1), {
        closureId: '10',
        closureDate: new Date('2026-04-02'),
        reason: '변경된 사유',
      });

      expect(result.id).toBe('10');
      expect(repo.updateStoreSpecialClosure).toHaveBeenCalled();
      expect(repo.createStoreSpecialClosure).not.toHaveBeenCalled();
    });
  });

  // ─── sellerDeleteStoreSpecialClosure ───

  describe('sellerDeleteStoreSpecialClosure', () => {
    it('존재하지 않는 특별 휴무를 삭제하면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      repo.findStoreSpecialClosureById.mockResolvedValue(null as never);

      await expect(
        service.sellerDeleteStoreSpecialClosure(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('정상 삭제 시 true를 반환하고 감사 로그를 생성해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      const closureRow = {
        id: BigInt(10),
        closure_date: new Date('2026-04-01'),
        reason: '정기 휴무',
        created_at: NOW,
        updated_at: NOW,
      };
      repo.findStoreSpecialClosureById.mockResolvedValue(closureRow as never);
      repo.softDeleteStoreSpecialClosure.mockResolvedValue(undefined as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerDeleteStoreSpecialClosure(
        BigInt(1),
        BigInt(10),
      );

      expect(result).toBe(true);
      expect(repo.softDeleteStoreSpecialClosure).toHaveBeenCalledWith(
        BigInt(10),
      );
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.STORE,
          targetId: BigInt(100),
          action: AuditActionType.DELETE,
          beforeJson: expect.objectContaining({
            closureDate: new Date('2026-04-01').toISOString(),
          }),
        }),
      );
    });
  });

  // ─── sellerUpdatePickupPolicy ───

  describe('sellerUpdatePickupPolicy', () => {
    beforeEach(() => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
    });

    it('매장 정보가 없으면 NotFoundException을 던져야 한다', async () => {
      repo.findStoreBySellerAccountId.mockResolvedValue(null as never);

      await expect(
        service.sellerUpdatePickupPolicy(BigInt(1), {
          pickupSlotIntervalMinutes: 30,
          minLeadTimeMinutes: 60,
          maxDaysAhead: 7,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([4, 181, 0, -1])(
      'pickupSlotIntervalMinutes가 범위(5~180) 밖(%i)이면 BadRequestException을 던져야 한다',
      async (value) => {
        repo.findStoreBySellerAccountId.mockResolvedValue({} as never);

        await expect(
          service.sellerUpdatePickupPolicy(BigInt(1), {
            pickupSlotIntervalMinutes: value,
            minLeadTimeMinutes: 60,
            maxDaysAhead: 7,
          }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it.each([-1, 10081])(
      'minLeadTimeMinutes가 범위(0~10080) 밖(%i)이면 BadRequestException을 던져야 한다',
      async (value) => {
        repo.findStoreBySellerAccountId.mockResolvedValue({} as never);

        await expect(
          service.sellerUpdatePickupPolicy(BigInt(1), {
            pickupSlotIntervalMinutes: 30,
            minLeadTimeMinutes: value,
            maxDaysAhead: 7,
          }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it.each([0, -1, 366])(
      'maxDaysAhead가 범위(1~365) 밖(%i)이면 BadRequestException을 던져야 한다',
      async (value) => {
        repo.findStoreBySellerAccountId.mockResolvedValue({} as never);

        await expect(
          service.sellerUpdatePickupPolicy(BigInt(1), {
            pickupSlotIntervalMinutes: 30,
            minLeadTimeMinutes: 60,
            maxDaysAhead: value,
          }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('정상 수정 시 업데이트된 매장 정보를 반환하고 감사 로그를 생성해야 한다', async () => {
      repo.findStoreBySellerAccountId.mockResolvedValue(STORE_ROW as never);
      const updatedRow = {
        ...STORE_ROW,
        pickup_slot_interval_minutes: 15,
        min_lead_time_minutes: 30,
        max_days_ahead: 14,
        updated_at: new Date('2026-03-30T13:00:00Z'),
      };
      repo.updateStore.mockResolvedValue(updatedRow as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerUpdatePickupPolicy(BigInt(1), {
        pickupSlotIntervalMinutes: 15,
        minLeadTimeMinutes: 30,
        maxDaysAhead: 14,
      });

      expect(result.id).toBe('100');
      expect(result.pickupSlotIntervalMinutes).toBe(15);
      expect(result.minLeadTimeMinutes).toBe(30);
      expect(result.maxDaysAhead).toBe(14);
      expect(repo.updateStore).toHaveBeenCalledWith({
        storeId: BigInt(100),
        data: {
          pickup_slot_interval_minutes: 15,
          min_lead_time_minutes: 30,
          max_days_ahead: 14,
        },
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.STORE,
          targetId: BigInt(100),
          action: AuditActionType.UPDATE,
          beforeJson: expect.objectContaining({
            pickupSlotIntervalMinutes: 30,
            minLeadTimeMinutes: 60,
            maxDaysAhead: 7,
          }),
          afterJson: expect.objectContaining({
            pickupSlotIntervalMinutes: 15,
            minLeadTimeMinutes: 30,
            maxDaysAhead: 14,
          }),
        }),
      );
    });
  });

  // ─── sellerUpsertStoreDailyCapacity ───

  describe('sellerUpsertStoreDailyCapacity', () => {
    beforeEach(() => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
    });

    it('capacityId가 주어졌으나 조회되지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findStoreDailyCapacityById.mockResolvedValue(null as never);

      await expect(
        service.sellerUpsertStoreDailyCapacity(BigInt(1), {
          capacityId: '999',
          capacityDate: new Date('2026-04-01'),
          capacity: 100,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([0, -1, 5001])(
      'capacity가 범위(1~5000) 밖(%i)이면 BadRequestException을 던져야 한다',
      async (value) => {
        await expect(
          service.sellerUpsertStoreDailyCapacity(BigInt(1), {
            capacityDate: new Date('2026-04-01'),
            capacity: value,
          }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('capacityId가 없으면 create 경로를 타야 한다', async () => {
      const capacityRow = {
        id: BigInt(20),
        capacity_date: new Date('2026-04-01'),
        capacity: 100,
        created_at: new Date(),
        updated_at: new Date(),
      };
      repo.createStoreDailyCapacity.mockResolvedValue(capacityRow as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerUpsertStoreDailyCapacity(BigInt(1), {
        capacityDate: new Date('2026-04-01'),
        capacity: 100,
      });

      expect(result.id).toBe('20');
      expect(repo.createStoreDailyCapacity).toHaveBeenCalled();
      expect(repo.updateStoreDailyCapacity).not.toHaveBeenCalled();
    });

    it('capacityId가 있으면 update 경로를 타야 한다', async () => {
      repo.findStoreDailyCapacityById.mockResolvedValue({
        id: BigInt(20),
      } as never);
      const capacityRow = {
        id: BigInt(20),
        capacity_date: new Date('2026-04-02'),
        capacity: 200,
        created_at: new Date(),
        updated_at: new Date(),
      };
      repo.updateStoreDailyCapacity.mockResolvedValue(capacityRow as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerUpsertStoreDailyCapacity(BigInt(1), {
        capacityId: '20',
        capacityDate: new Date('2026-04-02'),
        capacity: 200,
      });

      expect(result.id).toBe('20');
      expect(repo.updateStoreDailyCapacity).toHaveBeenCalled();
      expect(repo.createStoreDailyCapacity).not.toHaveBeenCalled();
    });
  });

  // ─── sellerDeleteStoreDailyCapacity ───

  describe('sellerDeleteStoreDailyCapacity', () => {
    it('존재하지 않는 일별 용량을 삭제하면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      repo.findStoreDailyCapacityById.mockResolvedValue(null as never);

      await expect(
        service.sellerDeleteStoreDailyCapacity(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('정상 삭제 시 true를 반환하고 감사 로그를 생성해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      const capacityRow = {
        id: BigInt(20),
        capacity_date: new Date('2026-04-01'),
        capacity: 100,
        created_at: NOW,
        updated_at: NOW,
      };
      repo.findStoreDailyCapacityById.mockResolvedValue(capacityRow as never);
      repo.softDeleteStoreDailyCapacity.mockResolvedValue(undefined as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerDeleteStoreDailyCapacity(
        BigInt(1),
        BigInt(20),
      );

      expect(result).toBe(true);
      expect(repo.softDeleteStoreDailyCapacity).toHaveBeenCalledWith(
        BigInt(20),
      );
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.STORE,
          targetId: BigInt(100),
          action: AuditActionType.DELETE,
          beforeJson: expect.objectContaining({
            capacityDate: new Date('2026-04-01').toISOString().slice(0, 10),
            capacity: 100,
          }),
        }),
      );
    });
  });
});
