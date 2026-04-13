import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { RecentProductViewRepository } from '@/features/user/repositories/recent-product-view.repository';
import { UserRecentViewService } from '@/features/user/services/user-recent-view.service';

describe('UserRecentViewService', () => {
  let service: UserRecentViewService;
  let recentViewRepo: jest.Mocked<RecentProductViewRepository>;
  let productRepo: jest.Mocked<ProductRepository>;

  const accountId = BigInt(1);

  beforeEach(async () => {
    recentViewRepo = {
      findRecentByAccountPaginated: jest.fn(),
      upsertView: jest.fn(),
      countByAccount: jest.fn(),
      deleteOldestOverLimit: jest.fn(),
      softDeleteByProduct: jest.fn(),
      softDeleteAllByAccount: jest.fn(),
    } as unknown as jest.Mocked<RecentProductViewRepository>;

    productRepo = {
      findActiveProduct: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRecentViewService,
        { provide: RecentProductViewRepository, useValue: recentViewRepo },
        { provide: ProductRepository, useValue: productRepo },
      ],
    }).compile();

    service = module.get<UserRecentViewService>(UserRecentViewService);
  });

  describe('list', () => {
    it('최근 본 상품 목록을 반환해야 한다', async () => {
      recentViewRepo.findRecentByAccountPaginated.mockResolvedValue({
        items: [
          {
            product_id: BigInt(200),
            viewed_at: new Date('2026-04-12'),
            product: {
              name: '레터링 케이크',
              regular_price: 45000,
              sale_price: 40000,
              store: { store_name: '스웨이드 베이커리' },
              images: [{ image_url: 'https://s3.example.com/cake.jpg' }],
            },
          },
        ],
        totalCount: 1,
      });

      const result = await service.list(accountId);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        productId: '200',
        productName: '레터링 케이크',
        storeName: '스웨이드 베이커리',
      });
      expect(result.totalCount).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('offset + limit < totalCount이면 hasMore가 true여야 한다', async () => {
      recentViewRepo.findRecentByAccountPaginated.mockResolvedValue({
        items: [],
        totalCount: 25,
      });

      const result = await service.list(accountId, { offset: 0, limit: 20 });

      expect(result.hasMore).toBe(true);
    });

    it('limit이 0이면 에러를 던져야 한다', async () => {
      await expect(service.list(accountId, { limit: 0 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('offset이 음수이면 에러를 던져야 한다', async () => {
      await expect(service.list(accountId, { offset: -1 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('record', () => {
    it('상품이 존재하면 upsert 후 초과분을 정리해야 한다', async () => {
      productRepo.findActiveProduct.mockResolvedValue({ id: BigInt(200) });
      recentViewRepo.upsertView.mockResolvedValue(undefined);
      recentViewRepo.deleteOldestOverLimit.mockResolvedValue(undefined);

      const result = await service.record(accountId, '200');

      expect(result).toBe(true);
      expect(recentViewRepo.upsertView).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId,
          productId: BigInt(200),
        }),
      );
      expect(recentViewRepo.deleteOldestOverLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId,
          maxCount: 50,
        }),
      );
    });

    it('상품이 존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      productRepo.findActiveProduct.mockResolvedValue(null);

      await expect(service.record(accountId, '999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('유효하지 않은 productId이면 BadRequestException을 던져야 한다', async () => {
      await expect(service.record(accountId, 'abc')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('deleteOne', () => {
    it('삭제 성공 시 true를 반환해야 한다', async () => {
      recentViewRepo.softDeleteByProduct.mockResolvedValue(true);

      const result = await service.deleteOne(accountId, '200');

      expect(result).toBe(true);
    });

    it('존재하지 않는 항목이면 false를 반환해야 한다', async () => {
      recentViewRepo.softDeleteByProduct.mockResolvedValue(false);

      const result = await service.deleteOne(accountId, '999');

      expect(result).toBe(false);
    });
  });

  describe('clearAll', () => {
    it('전체 삭제 후 true를 반환해야 한다', async () => {
      recentViewRepo.softDeleteAllByAccount.mockResolvedValue(5);

      const result = await service.clearAll(accountId);

      expect(result).toBe(true);
    });

    it('삭제할 항목이 없어도 true를 반환해야 한다', async () => {
      recentViewRepo.softDeleteAllByAccount.mockResolvedValue(0);

      const result = await service.clearAll(accountId);

      expect(result).toBe(true);
    });
  });
});
