import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';

const SELLER_CONTEXT = {
  id: BigInt(1),
  account_type: 'SELLER',
  status: 'ACTIVE',
  store: { id: BigInt(100) },
};

describe('SellerOptionService', () => {
  let service: SellerOptionService;
  let repo: jest.Mocked<SellerRepository>;
  let productRepo: jest.Mocked<ProductRepository>;

  beforeEach(async () => {
    repo = {
      findSellerAccountContext: jest.fn(),
      createAuditLog: jest.fn(),
    } as unknown as jest.Mocked<SellerRepository>;

    productRepo = {
      findProductByIdIncludingInactive: jest.fn(),
      createOptionGroup: jest.fn(),
      findOptionGroupById: jest.fn(),
      updateOptionGroup: jest.fn(),
      softDeleteOptionGroup: jest.fn(),
      listOptionGroupsByProduct: jest.fn(),
      reorderOptionGroups: jest.fn(),
      createOptionItem: jest.fn(),
      findOptionItemById: jest.fn(),
      updateOptionItem: jest.fn(),
      softDeleteOptionItem: jest.fn(),
      listOptionItemsByGroup: jest.fn(),
      reorderOptionItems: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerOptionService,
        {
          provide: SellerRepository,
          useValue: repo,
        },
        {
          provide: ProductRepository,
          useValue: productRepo,
        },
      ],
    }).compile();

    service = module.get<SellerOptionService>(SellerOptionService);

    // 기본: 유효한 판매자 컨텍스트 반환
    repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
  });

  // ── 옵션 그룹 ──

  describe('sellerCreateOptionGroup', () => {
    it('maxSelect가 minSelect보다 작으면 BadRequestException을 던져야 한다', async () => {
      productRepo.findProductByIdIncludingInactive.mockResolvedValue({
        id: BigInt(10),
      } as never);

      await expect(
        service.sellerCreateOptionGroup(BigInt(1), {
          productId: '10',
          name: '옵션그룹',
          minSelect: 3,
          maxSelect: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sellerUpdateOptionGroup', () => {
    it('옵션 그룹이 없으면 NotFoundException을 던져야 한다', async () => {
      productRepo.findOptionGroupById.mockResolvedValue(null as never);

      await expect(
        service.sellerUpdateOptionGroup(BigInt(1), {
          optionGroupId: '999',
          name: '수정',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('maxSelect가 minSelect보다 작으면 BadRequestException을 던져야 한다', async () => {
      productRepo.findOptionGroupById.mockResolvedValue({
        id: BigInt(1),
        product_id: BigInt(10),
        product: { store_id: BigInt(100) },
      } as never);

      await expect(
        service.sellerUpdateOptionGroup(BigInt(1), {
          optionGroupId: '1',
          minSelect: 5,
          maxSelect: 2,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sellerReorderOptionGroups', () => {
    it('optionGroupIds 길이가 불일치하면 BadRequestException을 던져야 한다', async () => {
      productRepo.findProductByIdIncludingInactive.mockResolvedValue({
        id: BigInt(10),
      } as never);
      productRepo.listOptionGroupsByProduct.mockResolvedValue([
        { id: BigInt(1) },
        { id: BigInt(2) },
      ] as never);

      await expect(
        service.sellerReorderOptionGroups(BigInt(1), {
          productId: '10',
          optionGroupIds: ['1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── 옵션 아이템 ──

  describe('sellerCreateOptionItem', () => {
    it('옵션 그룹이 없으면 NotFoundException을 던져야 한다', async () => {
      productRepo.findOptionGroupById.mockResolvedValue(null as never);

      await expect(
        service.sellerCreateOptionItem(BigInt(1), {
          optionGroupId: '999',
          title: '옵션',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerUpdateOptionItem', () => {
    it('옵션 아이템이 없으면 NotFoundException을 던져야 한다', async () => {
      productRepo.findOptionItemById.mockResolvedValue(null as never);

      await expect(
        service.sellerUpdateOptionItem(BigInt(1), {
          optionItemId: '999',
          title: '수정',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerReorderOptionItems', () => {
    it('optionItemIds 길이가 불일치하면 BadRequestException을 던져야 한다', async () => {
      productRepo.findOptionGroupById.mockResolvedValue({
        id: BigInt(1),
        product: { store_id: BigInt(100) },
      } as never);
      productRepo.listOptionItemsByGroup.mockResolvedValue([
        { id: BigInt(1) },
        { id: BigInt(2) },
      ] as never);

      await expect(
        service.sellerReorderOptionItems(BigInt(1), {
          optionGroupId: '1',
          optionItemIds: ['1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
