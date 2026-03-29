import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditActionType, AuditTargetType } from '@prisma/client';

import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerProductCrudService } from '@/features/seller/services/seller-product-crud.service';

const SELLER_CONTEXT = {
  id: BigInt(1),
  account_type: 'SELLER',
  status: 'ACTIVE',
  store: { id: BigInt(100) },
};

const USER_CONTEXT = {
  id: BigInt(1),
  account_type: 'USER',
  status: 'ACTIVE',
  store: { id: BigInt(100) },
};

const NOW = new Date('2026-03-30T00:00:00.000Z');

/** 상품 상세 조회 결과 픽스처 */
function makeProductDetailRow(overrides?: Record<string, unknown>) {
  return {
    id: BigInt(10),
    store_id: BigInt(100),
    name: '테스트 케이크',
    description: '맛있는 케이크',
    purchase_notice: '주문 후 3시간 소요',
    regular_price: 30000,
    sale_price: 25000,
    currency: 'KRW',
    base_design_image_url: null,
    preparation_time_minutes: 180,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
    images: [
      {
        id: BigInt(1),
        image_url: 'https://example.com/img1.png',
        sort_order: 0,
      },
    ],
    product_categories: [{ category: { id: BigInt(50), name: '케이크' } }],
    product_tags: [{ tag: { id: BigInt(60), name: '생일' } }],
    option_groups: [],
    custom_template: null,
    ...overrides,
  };
}

/** 상품 생성 결과 픽스처 (createProduct 반환값) */
function makeCreatedProductRow(overrides?: Record<string, unknown>) {
  return {
    id: BigInt(10),
    store_id: BigInt(100),
    name: '테스트 케이크',
    regular_price: 30000,
    sale_price: 25000,
    currency: 'KRW',
    description: '맛있는 케이크',
    purchase_notice: null,
    base_design_image_url: null,
    preparation_time_minutes: 180,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('SellerProductCrudService', () => {
  let service: SellerProductCrudService;
  let repo: jest.Mocked<SellerRepository>;
  let productRepo: jest.Mocked<ProductRepository>;

  beforeEach(async () => {
    repo = {
      findSellerAccountContext: jest.fn(),
      createAuditLog: jest.fn(),
    } as unknown as jest.Mocked<SellerRepository>;

    productRepo = {
      findProductById: jest.fn(),
      findProductByIdIncludingInactive: jest.fn(),
      createProduct: jest.fn(),
      updateProduct: jest.fn(),
      softDeleteProduct: jest.fn(),
      countProductImages: jest.fn(),
      addProductImage: jest.fn(),
      findProductImageById: jest.fn(),
      softDeleteProductImage: jest.fn(),
      listProductImages: jest.fn(),
      reorderProductImages: jest.fn(),
      listProductsByStore: jest.fn(),
      findCategoryIds: jest.fn(),
      replaceProductCategories: jest.fn(),
      findTagIds: jest.fn(),
      replaceProductTags: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerProductCrudService,
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

    service = module.get<SellerProductCrudService>(SellerProductCrudService);
  });

  // ── 컨텍스트 검증 ──

  it('판매자 계정이 아니면 ForbiddenException을 던져야 한다', async () => {
    repo.findSellerAccountContext.mockResolvedValue(USER_CONTEXT as never);

    await expect(service.sellerProduct(BigInt(1), BigInt(10))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('계정을 찾을 수 없으면 UnauthorizedException을 던져야 한다', async () => {
    repo.findSellerAccountContext.mockResolvedValue(null as never);

    await expect(service.sellerProduct(BigInt(1), BigInt(10))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // ── 상품 CRUD ──

  describe('sellerProducts', () => {
    it('상품 목록을 커서 페이지네이션으로 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);

      const row1 = makeProductDetailRow({ id: BigInt(10) });
      const row2 = makeProductDetailRow({ id: BigInt(11), name: '롤케이크' });
      productRepo.listProductsByStore.mockResolvedValue([row1, row2] as never);

      const result = await service.sellerProducts(BigInt(1), {
        limit: 20,
        cursor: null,
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('10');
      expect(result.items[1].id).toBe('11');
      expect(result.nextCursor).toBeNull();
      expect(productRepo.listProductsByStore).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: BigInt(100),
          limit: 20,
          isActive: true,
        }),
      );
    });
  });

  describe('sellerProduct', () => {
    it('상품이 없으면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      productRepo.findProductById.mockResolvedValue(null as never);

      await expect(
        service.sellerProduct(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('상품 ID로 단건 조회 결과를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      const row = makeProductDetailRow();
      productRepo.findProductById.mockResolvedValue(row as never);

      const result = await service.sellerProduct(BigInt(1), BigInt(10));

      expect(result.id).toBe('10');
      expect(result.storeId).toBe('100');
      expect(result.name).toBe('테스트 케이크');
      expect(result.regularPrice).toBe(30000);
      expect(result.salePrice).toBe(25000);
      expect(result.currency).toBe('KRW');
      expect(result.images).toHaveLength(1);
      expect(result.categories).toHaveLength(1);
      expect(result.categories[0].name).toBe('케이크');
      expect(result.tags).toHaveLength(1);
      expect(result.tags[0].name).toBe('생일');
      expect(productRepo.findProductById).toHaveBeenCalledWith({
        productId: BigInt(10),
        storeId: BigInt(100),
      });
    });
  });

  describe('sellerCreateProduct', () => {
    it('regularPrice가 1 미만이면 BadRequestException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);

      await expect(
        service.sellerCreateProduct(BigInt(1), {
          name: '테스트 상품',
          regularPrice: 0,
          initialImageUrl: 'https://example.com/img.png',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salePrice가 regularPrice보다 크면 BadRequestException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);

      await expect(
        service.sellerCreateProduct(BigInt(1), {
          name: '테스트 상품',
          regularPrice: 1000,
          salePrice: 2000,
          initialImageUrl: 'https://example.com/img.png',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('유효한 입력이면 상품을 생성하고 결과를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      const created = makeCreatedProductRow();
      productRepo.createProduct.mockResolvedValue(created as never);
      productRepo.addProductImage.mockResolvedValue({
        id: BigInt(1),
        image_url: 'https://example.com/img.png',
        sort_order: 0,
      } as never);
      const detail = makeProductDetailRow();
      productRepo.findProductByIdIncludingInactive.mockResolvedValue(
        detail as never,
      );

      const result = await service.sellerCreateProduct(BigInt(1), {
        name: '테스트 케이크',
        regularPrice: 30000,
        salePrice: 25000,
        initialImageUrl: 'https://example.com/img.png',
      });

      expect(result.id).toBe('10');
      expect(result.name).toBe('테스트 케이크');
      expect(productRepo.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: BigInt(100),
          data: expect.objectContaining({
            name: '테스트 케이크',
            regular_price: 30000,
            sale_price: 25000,
          }),
        }),
      );
      expect(productRepo.addProductImage).toHaveBeenCalledWith({
        productId: BigInt(10),
        imageUrl: 'https://example.com/img.png',
        sortOrder: 0,
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.PRODUCT,
          targetId: BigInt(10),
          action: AuditActionType.CREATE,
        }),
      );
    });
  });

  describe('sellerUpdateProduct', () => {
    it('상품이 없으면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      productRepo.findProductByIdIncludingInactive.mockResolvedValue(
        null as never,
      );

      await expect(
        service.sellerUpdateProduct(BigInt(1), {
          productId: '999',
          name: '수정',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('유효한 입력이면 상품을 수정하고 결과를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      const current = makeProductDetailRow();
      const updated = makeCreatedProductRow({ name: '수정된 케이크' });
      const detail = makeProductDetailRow({ name: '수정된 케이크' });

      // 첫 번째 호출: current 조회, 두 번째 호출: 업데이트 후 detail 조회
      productRepo.findProductByIdIncludingInactive
        .mockResolvedValueOnce(current as never)
        .mockResolvedValueOnce(detail as never);
      productRepo.updateProduct.mockResolvedValue(updated as never);

      const result = await service.sellerUpdateProduct(BigInt(1), {
        productId: '10',
        name: '수정된 케이크',
      });

      expect(result.id).toBe('10');
      expect(result.name).toBe('수정된 케이크');
      expect(productRepo.updateProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: BigInt(10),
          data: expect.objectContaining({ name: '수정된 케이크' }),
        }),
      );
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.PRODUCT,
          targetId: BigInt(10),
          action: AuditActionType.UPDATE,
          beforeJson: { name: '테스트 케이크' },
          afterJson: { name: '수정된 케이크' },
        }),
      );
    });
  });

  describe('sellerDeleteProduct', () => {
    it('상품이 없으면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      productRepo.findProductByIdIncludingInactive.mockResolvedValue(
        null as never,
      );

      await expect(
        service.sellerDeleteProduct(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('상품을 소프트 삭제하고 true를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      const current = makeProductDetailRow();
      productRepo.findProductByIdIncludingInactive.mockResolvedValue(
        current as never,
      );
      productRepo.softDeleteProduct.mockResolvedValue(undefined as never);

      const result = await service.sellerDeleteProduct(BigInt(1), BigInt(10));

      expect(result).toBe(true);
      expect(productRepo.softDeleteProduct).toHaveBeenCalledWith(BigInt(10));
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.PRODUCT,
          targetId: BigInt(10),
          action: AuditActionType.DELETE,
          beforeJson: { name: '테스트 케이크' },
        }),
      );
    });
  });

  describe('sellerSetProductActive', () => {
    it('상품 활성 상태를 변경하고 결과를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      const current = makeProductDetailRow({ is_active: true });
      const detail = makeProductDetailRow({ is_active: false });

      productRepo.findProductByIdIncludingInactive
        .mockResolvedValueOnce(current as never)
        .mockResolvedValueOnce(detail as never);
      productRepo.updateProduct.mockResolvedValue(undefined as never);

      const result = await service.sellerSetProductActive(BigInt(1), {
        productId: '10',
        isActive: false,
      });

      expect(result.id).toBe('10');
      expect(result.isActive).toBe(false);
      expect(productRepo.updateProduct).toHaveBeenCalledWith({
        productId: BigInt(10),
        data: { is_active: false },
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.PRODUCT,
          targetId: BigInt(10),
          action: AuditActionType.STATUS_CHANGE,
          beforeJson: { isActive: true },
          afterJson: { isActive: false },
        }),
      );
    });
  });

  // ── 이미지 ──

  describe('sellerAddProductImage', () => {
    it('이미지가 5개 이상이면 BadRequestException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      productRepo.findProductByIdIncludingInactive.mockResolvedValue({
        id: BigInt(10),
      } as never);
      productRepo.countProductImages.mockResolvedValue(5 as never);

      await expect(
        service.sellerAddProductImage(BigInt(1), {
          productId: '10',
          imageUrl: 'https://example.com/img.png',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('이미지를 추가하고 결과를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      productRepo.findProductByIdIncludingInactive.mockResolvedValue({
        id: BigInt(10),
      } as never);
      productRepo.countProductImages.mockResolvedValue(2 as never);
      productRepo.addProductImage.mockResolvedValue({
        id: BigInt(3),
        image_url: 'https://example.com/new.png',
        sort_order: 2,
      } as never);

      const result = await service.sellerAddProductImage(BigInt(1), {
        productId: '10',
        imageUrl: 'https://example.com/new.png',
      });

      expect(result.id).toBe('3');
      expect(result.imageUrl).toBe('https://example.com/new.png');
      expect(result.sortOrder).toBe(2);
      expect(productRepo.addProductImage).toHaveBeenCalledWith({
        productId: BigInt(10),
        imageUrl: 'https://example.com/new.png',
        sortOrder: 2,
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.PRODUCT,
          targetId: BigInt(10),
          action: AuditActionType.UPDATE,
          afterJson: { imageId: '3' },
        }),
      );
    });
  });

  describe('sellerDeleteProductImage', () => {
    it('이미지가 1개 이하이면 BadRequestException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      productRepo.findProductImageById.mockResolvedValue({
        id: BigInt(1),
        product_id: BigInt(10),
        product: { store_id: BigInt(100) },
      } as never);
      productRepo.countProductImages.mockResolvedValue(1 as never);

      await expect(
        service.sellerDeleteProductImage(BigInt(1), BigInt(1)),
      ).rejects.toThrow(BadRequestException);
    });

    it('이미지가 없으면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      productRepo.findProductImageById.mockResolvedValue(null as never);

      await expect(
        service.sellerDeleteProductImage(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 스토어의 이미지면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      productRepo.findProductImageById.mockResolvedValue({
        id: BigInt(1),
        product_id: BigInt(10),
        product: { store_id: BigInt(999) },
      } as never);

      await expect(
        service.sellerDeleteProductImage(BigInt(1), BigInt(1)),
      ).rejects.toThrow(NotFoundException);
    });

    it('이미지를 소프트 삭제하고 true를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      productRepo.findProductImageById.mockResolvedValue({
        id: BigInt(5),
        product_id: BigInt(10),
        product: { store_id: BigInt(100) },
      } as never);
      productRepo.countProductImages.mockResolvedValue(3 as never);
      productRepo.softDeleteProductImage.mockResolvedValue(undefined as never);

      const result = await service.sellerDeleteProductImage(
        BigInt(1),
        BigInt(5),
      );

      expect(result).toBe(true);
      expect(productRepo.softDeleteProductImage).toHaveBeenCalledWith(
        BigInt(5),
      );
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.PRODUCT,
          targetId: BigInt(10),
          action: AuditActionType.UPDATE,
          beforeJson: { imageId: '5' },
        }),
      );
    });
  });

  describe('sellerReorderProductImages', () => {
    it('imageIds 길이가 불일치하면 BadRequestException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      productRepo.findProductByIdIncludingInactive.mockResolvedValue({
        id: BigInt(10),
      } as never);
      productRepo.listProductImages.mockResolvedValue([
        { id: BigInt(1) },
        { id: BigInt(2) },
      ] as never);

      await expect(
        service.sellerReorderProductImages(BigInt(1), {
          productId: '10',
          imageIds: ['1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('이미지 순서를 변경하고 결과를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      productRepo.findProductByIdIncludingInactive.mockResolvedValue({
        id: BigInt(10),
      } as never);
      productRepo.listProductImages.mockResolvedValue([
        { id: BigInt(1) },
        { id: BigInt(2) },
      ] as never);
      productRepo.reorderProductImages.mockResolvedValue([
        {
          id: BigInt(2),
          image_url: 'https://example.com/img2.png',
          sort_order: 0,
        },
        {
          id: BigInt(1),
          image_url: 'https://example.com/img1.png',
          sort_order: 1,
        },
      ] as never);

      const result = await service.sellerReorderProductImages(BigInt(1), {
        productId: '10',
        imageIds: ['2', '1'],
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('2');
      expect(result[0].sortOrder).toBe(0);
      expect(result[1].id).toBe('1');
      expect(result[1].sortOrder).toBe(1);
      expect(productRepo.reorderProductImages).toHaveBeenCalledWith({
        productId: BigInt(10),
        imageIds: [BigInt(2), BigInt(1)],
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.PRODUCT,
          targetId: BigInt(10),
          action: AuditActionType.UPDATE,
          afterJson: { imageIds: ['2', '1'] },
        }),
      );
    });
  });

  // ── 카테고리 / 태그 ──

  describe('sellerSetProductCategories', () => {
    it('상품에 카테고리를 설정하고 결과를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      const product = makeProductDetailRow();
      const detail = makeProductDetailRow({
        product_categories: [
          { category: { id: BigInt(50), name: '케이크' } },
          { category: { id: BigInt(51), name: '마카롱' } },
        ],
      });

      productRepo.findProductByIdIncludingInactive
        .mockResolvedValueOnce(product as never)
        .mockResolvedValueOnce(detail as never);
      productRepo.findCategoryIds.mockResolvedValue([
        { id: BigInt(50) },
        { id: BigInt(51) },
      ] as never);
      productRepo.replaceProductCategories.mockResolvedValue(
        undefined as never,
      );

      const result = await service.sellerSetProductCategories(BigInt(1), {
        productId: '10',
        categoryIds: ['50', '51'],
      });

      expect(result.id).toBe('10');
      expect(result.categories).toHaveLength(2);
      expect(result.categories[0].name).toBe('케이크');
      expect(result.categories[1].name).toBe('마카롱');
      expect(productRepo.replaceProductCategories).toHaveBeenCalledWith({
        productId: BigInt(10),
        categoryIds: [BigInt(50), BigInt(51)],
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.PRODUCT,
          targetId: BigInt(10),
          action: AuditActionType.UPDATE,
          afterJson: { categoryIds: ['50', '51'] },
        }),
      );
    });
  });

  describe('sellerSetProductTags', () => {
    it('상품에 태그를 설정하고 결과를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      const product = makeProductDetailRow();
      const detail = makeProductDetailRow({
        product_tags: [
          { tag: { id: BigInt(60), name: '생일' } },
          { tag: { id: BigInt(61), name: '기념일' } },
        ],
      });

      productRepo.findProductByIdIncludingInactive
        .mockResolvedValueOnce(product as never)
        .mockResolvedValueOnce(detail as never);
      productRepo.findTagIds.mockResolvedValue([
        { id: BigInt(60) },
        { id: BigInt(61) },
      ] as never);
      productRepo.replaceProductTags.mockResolvedValue(undefined as never);

      const result = await service.sellerSetProductTags(BigInt(1), {
        productId: '10',
        tagIds: ['60', '61'],
      });

      expect(result.id).toBe('10');
      expect(result.tags).toHaveLength(2);
      expect(result.tags[0].name).toBe('생일');
      expect(result.tags[1].name).toBe('기념일');
      expect(productRepo.replaceProductTags).toHaveBeenCalledWith({
        productId: BigInt(10),
        tagIds: [BigInt(60), BigInt(61)],
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(1),
          storeId: BigInt(100),
          targetType: AuditTargetType.PRODUCT,
          targetId: BigInt(10),
          action: AuditActionType.UPDATE,
          afterJson: { tagIds: ['60', '61'] },
        }),
      );
    });
  });
});
