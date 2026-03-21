import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ProductRepository } from '../../product';
import { SellerRepository } from '../repositories/seller.repository';

import { SellerProductCrudService } from './seller-product-crud.service';

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

  describe('sellerProduct', () => {
    it('상품이 없으면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      productRepo.findProductById.mockResolvedValue(null as never);

      await expect(
        service.sellerProduct(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
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
  });
});
