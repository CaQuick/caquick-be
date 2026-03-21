import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

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
  });
});
