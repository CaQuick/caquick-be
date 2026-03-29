import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditActionType, AuditTargetType } from '@prisma/client';

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

    it('유효한 입력으로 옵션 그룹을 생성하고 결과를 반환해야 한다', async () => {
      productRepo.findProductByIdIncludingInactive.mockResolvedValue({
        id: BigInt(10),
      } as never);

      const createdRow = {
        id: BigInt(50),
        product_id: BigInt(10),
        name: '사이즈',
        is_required: true,
        min_select: 1,
        max_select: 1,
        option_requires_description: false,
        option_requires_image: false,
        sort_order: 0,
        is_active: true,
        option_items: [],
      };
      productRepo.createOptionGroup.mockResolvedValue(createdRow as never);

      const result = await service.sellerCreateOptionGroup(BigInt(1), {
        productId: '10',
        name: '사이즈',
      });

      expect(result).toEqual({
        id: '50',
        productId: '10',
        name: '사이즈',
        isRequired: true,
        minSelect: 1,
        maxSelect: 1,
        optionRequiresDescription: false,
        optionRequiresImage: false,
        sortOrder: 0,
        isActive: true,
        optionItems: [],
      });

      expect(productRepo.createOptionGroup).toHaveBeenCalledWith({
        productId: BigInt(10),
        data: expect.objectContaining({
          name: '사이즈',
          is_required: true,
          min_select: 1,
          max_select: 1,
        }),
      });

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.CREATE,
        afterJson: { optionGroupId: '50' },
      });
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

    it('유효한 입력으로 옵션 그룹을 수정하고 결과를 반환해야 한다', async () => {
      productRepo.findOptionGroupById.mockResolvedValue({
        id: BigInt(5),
        product_id: BigInt(10),
        min_select: 1,
        max_select: 3,
        product: { store_id: BigInt(100) },
      } as never);

      const updatedRow = {
        id: BigInt(5),
        product_id: BigInt(10),
        name: '수정된 옵션그룹',
        is_required: false,
        min_select: 1,
        max_select: 3,
        option_requires_description: true,
        option_requires_image: false,
        sort_order: 2,
        is_active: true,
        option_items: [],
      };
      productRepo.updateOptionGroup.mockResolvedValue(updatedRow as never);

      const result = await service.sellerUpdateOptionGroup(BigInt(1), {
        optionGroupId: '5',
        name: '수정된 옵션그룹',
        isRequired: false,
        optionRequiresDescription: true,
        sortOrder: 2,
      });

      expect(result).toEqual({
        id: '5',
        productId: '10',
        name: '수정된 옵션그룹',
        isRequired: false,
        minSelect: 1,
        maxSelect: 3,
        optionRequiresDescription: true,
        optionRequiresImage: false,
        sortOrder: 2,
        isActive: true,
        optionItems: [],
      });

      expect(productRepo.updateOptionGroup).toHaveBeenCalledWith({
        optionGroupId: BigInt(5),
        data: expect.objectContaining({
          name: '수정된 옵션그룹',
          is_required: false,
          option_requires_description: true,
          sort_order: 2,
        }),
      });

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.UPDATE,
        afterJson: { optionGroupId: '5' },
      });
    });
  });

  describe('sellerDeleteOptionGroup', () => {
    it('옵션 그룹이 없으면 NotFoundException을 던져야 한다', async () => {
      productRepo.findOptionGroupById.mockResolvedValue(null as never);

      await expect(
        service.sellerDeleteOptionGroup(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('유효한 옵션 그룹을 소프트 삭제하고 true를 반환해야 한다', async () => {
      productRepo.findOptionGroupById.mockResolvedValue({
        id: BigInt(5),
        product_id: BigInt(10),
        product: { store_id: BigInt(100) },
      } as never);
      productRepo.softDeleteOptionGroup.mockResolvedValue(undefined as never);

      const result = await service.sellerDeleteOptionGroup(
        BigInt(1),
        BigInt(5),
      );

      expect(result).toBe(true);

      expect(productRepo.softDeleteOptionGroup).toHaveBeenCalledWith(BigInt(5));

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.DELETE,
        beforeJson: { optionGroupId: '5' },
      });
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

    it('유효한 입력으로 옵션 그룹을 정렬하고 결과를 반환해야 한다', async () => {
      productRepo.findProductByIdIncludingInactive.mockResolvedValue({
        id: BigInt(10),
      } as never);
      productRepo.listOptionGroupsByProduct.mockResolvedValue([
        { id: BigInt(1) },
        { id: BigInt(2) },
      ] as never);

      const reorderedRows = [
        {
          id: BigInt(2),
          product_id: BigInt(10),
          name: '그룹B',
          is_required: true,
          min_select: 1,
          max_select: 1,
          option_requires_description: false,
          option_requires_image: false,
          sort_order: 0,
          is_active: true,
          option_items: [],
        },
        {
          id: BigInt(1),
          product_id: BigInt(10),
          name: '그룹A',
          is_required: true,
          min_select: 1,
          max_select: 1,
          option_requires_description: false,
          option_requires_image: false,
          sort_order: 1,
          is_active: true,
          option_items: [],
        },
      ];
      productRepo.reorderOptionGroups.mockResolvedValue(reorderedRows as never);

      const result = await service.sellerReorderOptionGroups(BigInt(1), {
        productId: '10',
        optionGroupIds: ['2', '1'],
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('2');
      expect(result[1].id).toBe('1');

      expect(productRepo.reorderOptionGroups).toHaveBeenCalledWith({
        productId: BigInt(10),
        optionGroupIds: [BigInt(2), BigInt(1)],
      });

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.UPDATE,
        afterJson: { optionGroupIds: ['2', '1'] },
      });
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

    it('유효한 입력으로 옵션 아이템을 생성하고 결과를 반환해야 한다', async () => {
      productRepo.findOptionGroupById.mockResolvedValue({
        id: BigInt(5),
        product_id: BigInt(10),
        product: { store_id: BigInt(100) },
      } as never);

      const createdRow = {
        id: BigInt(30),
        option_group_id: BigInt(5),
        title: '라지',
        description: '큰 사이즈',
        image_url: null,
        price_delta: 1000,
        sort_order: 0,
        is_active: true,
      };
      productRepo.createOptionItem.mockResolvedValue(createdRow as never);

      const result = await service.sellerCreateOptionItem(BigInt(1), {
        optionGroupId: '5',
        title: '라지',
        description: '큰 사이즈',
        priceDelta: 1000,
      });

      expect(result).toEqual({
        id: '30',
        optionGroupId: '5',
        title: '라지',
        description: '큰 사이즈',
        imageUrl: null,
        priceDelta: 1000,
        sortOrder: 0,
        isActive: true,
      });

      expect(productRepo.createOptionItem).toHaveBeenCalledWith({
        optionGroupId: BigInt(5),
        data: expect.objectContaining({
          title: '라지',
          description: '큰 사이즈',
          price_delta: 1000,
        }),
      });

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.CREATE,
        afterJson: { optionItemId: '30' },
      });
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

    it('유효한 입력으로 옵션 아이템을 수정하고 결과를 반환해야 한다', async () => {
      productRepo.findOptionItemById.mockResolvedValue({
        id: BigInt(30),
        option_group_id: BigInt(5),
        option_group: {
          product_id: BigInt(10),
          product: { store_id: BigInt(100) },
        },
      } as never);

      const updatedRow = {
        id: BigInt(30),
        option_group_id: BigInt(5),
        title: '미디엄',
        description: '중간 사이즈',
        image_url: 'https://example.com/img.png',
        price_delta: 500,
        sort_order: 1,
        is_active: true,
      };
      productRepo.updateOptionItem.mockResolvedValue(updatedRow as never);

      const result = await service.sellerUpdateOptionItem(BigInt(1), {
        optionItemId: '30',
        title: '미디엄',
        description: '중간 사이즈',
        imageUrl: 'https://example.com/img.png',
        priceDelta: 500,
        sortOrder: 1,
      });

      expect(result).toEqual({
        id: '30',
        optionGroupId: '5',
        title: '미디엄',
        description: '중간 사이즈',
        imageUrl: 'https://example.com/img.png',
        priceDelta: 500,
        sortOrder: 1,
        isActive: true,
      });

      expect(productRepo.updateOptionItem).toHaveBeenCalledWith({
        optionItemId: BigInt(30),
        data: expect.objectContaining({
          title: '미디엄',
          description: '중간 사이즈',
          image_url: 'https://example.com/img.png',
          price_delta: 500,
          sort_order: 1,
        }),
      });

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.UPDATE,
        afterJson: { optionItemId: '30' },
      });
    });
  });

  describe('sellerDeleteOptionItem', () => {
    it('옵션 아이템이 없으면 NotFoundException을 던져야 한다', async () => {
      productRepo.findOptionItemById.mockResolvedValue(null as never);

      await expect(
        service.sellerDeleteOptionItem(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('유효한 옵션 아이템을 소프트 삭제하고 true를 반환해야 한다', async () => {
      productRepo.findOptionItemById.mockResolvedValue({
        id: BigInt(30),
        option_group_id: BigInt(5),
        option_group: {
          product_id: BigInt(10),
          product: { store_id: BigInt(100) },
        },
      } as never);
      productRepo.softDeleteOptionItem.mockResolvedValue(undefined as never);

      const result = await service.sellerDeleteOptionItem(
        BigInt(1),
        BigInt(30),
      );

      expect(result).toBe(true);

      expect(productRepo.softDeleteOptionItem).toHaveBeenCalledWith(BigInt(30));

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.DELETE,
        beforeJson: { optionItemId: '30' },
      });
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

    it('유효한 입력으로 옵션 아이템을 정렬하고 결과를 반환해야 한다', async () => {
      productRepo.findOptionGroupById.mockResolvedValue({
        id: BigInt(5),
        product_id: BigInt(10),
        product: { store_id: BigInt(100) },
      } as never);
      productRepo.listOptionItemsByGroup.mockResolvedValue([
        { id: BigInt(30) },
        { id: BigInt(31) },
      ] as never);

      const reorderedRows = [
        {
          id: BigInt(31),
          option_group_id: BigInt(5),
          title: '아이템B',
          description: null,
          image_url: null,
          price_delta: 0,
          sort_order: 0,
          is_active: true,
        },
        {
          id: BigInt(30),
          option_group_id: BigInt(5),
          title: '아이템A',
          description: null,
          image_url: null,
          price_delta: 0,
          sort_order: 1,
          is_active: true,
        },
      ];
      productRepo.reorderOptionItems.mockResolvedValue(reorderedRows as never);

      const result = await service.sellerReorderOptionItems(BigInt(1), {
        optionGroupId: '5',
        optionItemIds: ['31', '30'],
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('31');
      expect(result[1].id).toBe('30');

      expect(productRepo.reorderOptionItems).toHaveBeenCalledWith({
        optionGroupId: BigInt(5),
        optionItemIds: [BigInt(31), BigInt(30)],
      });

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.UPDATE,
        afterJson: { optionItemIds: ['31', '30'] },
      });
    });
  });
});
