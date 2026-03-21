import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ProductRepository } from '../../product';
import { SellerRepository } from '../repositories/seller.repository';

import { SellerCustomTemplateService } from './seller-custom-template.service';

const SELLER_CONTEXT = {
  id: BigInt(1),
  account_type: 'SELLER',
  status: 'ACTIVE',
  store: { id: BigInt(100) },
};

describe('SellerCustomTemplateService', () => {
  let service: SellerCustomTemplateService;
  let repo: jest.Mocked<SellerRepository>;
  let productRepo: jest.Mocked<ProductRepository>;

  beforeEach(async () => {
    repo = {
      findSellerAccountContext: jest.fn(),
      createAuditLog: jest.fn(),
    } as unknown as jest.Mocked<SellerRepository>;

    productRepo = {
      findProductByIdIncludingInactive: jest.fn(),
      upsertProductCustomTemplate: jest.fn(),
      findCustomTemplateById: jest.fn(),
      setCustomTemplateActive: jest.fn(),
      upsertCustomTextToken: jest.fn(),
      findCustomTextTokenById: jest.fn(),
      softDeleteCustomTextToken: jest.fn(),
      listCustomTextTokens: jest.fn(),
      reorderCustomTextTokens: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerCustomTemplateService,
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

    service = module.get<SellerCustomTemplateService>(
      SellerCustomTemplateService,
    );

    // 기본: 유효한 판매자 컨텍스트 반환
    repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
  });

  // ── 커스텀 템플릿 ──

  describe('sellerUpsertProductCustomTemplate', () => {
    it('상품이 없으면 NotFoundException을 던져야 한다', async () => {
      productRepo.findProductByIdIncludingInactive.mockResolvedValue(
        null as never,
      );

      await expect(
        service.sellerUpsertProductCustomTemplate(BigInt(1), {
          productId: '999',
          baseImageUrl: 'https://example.com/img.png',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerSetProductCustomTemplateActive', () => {
    it('템플릿이 없으면 NotFoundException을 던져야 한다', async () => {
      productRepo.findCustomTemplateById.mockResolvedValue(null as never);

      await expect(
        service.sellerSetProductCustomTemplateActive(BigInt(1), {
          templateId: '999',
          isActive: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── 커스텀 텍스트 토큰 ──

  describe('sellerUpsertProductCustomTextToken', () => {
    it('템플릿이 없으면 NotFoundException을 던져야 한다', async () => {
      productRepo.findCustomTemplateById.mockResolvedValue(null as never);

      await expect(
        service.sellerUpsertProductCustomTextToken(BigInt(1), {
          templateId: '999',
          tokenKey: 'NAME',
          defaultText: '기본값',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('tokenId가 주어졌으나 토큰을 찾을 수 없으면 NotFoundException을 던져야 한다', async () => {
      productRepo.findCustomTemplateById.mockResolvedValue({
        id: BigInt(1),
        product: { store_id: BigInt(100) },
      } as never);
      productRepo.findCustomTextTokenById.mockResolvedValue(null as never);

      await expect(
        service.sellerUpsertProductCustomTextToken(BigInt(1), {
          templateId: '1',
          tokenId: '999',
          tokenKey: 'NAME',
          defaultText: '기본값',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerDeleteProductCustomTextToken', () => {
    it('토큰이 없으면 NotFoundException을 던져야 한다', async () => {
      productRepo.findCustomTextTokenById.mockResolvedValue(null as never);

      await expect(
        service.sellerDeleteProductCustomTextToken(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerReorderProductCustomTextTokens', () => {
    it('tokenIds 길이가 불일치하면 BadRequestException을 던져야 한다', async () => {
      productRepo.findCustomTemplateById.mockResolvedValue({
        id: BigInt(1),
        product: { store_id: BigInt(100) },
      } as never);
      productRepo.listCustomTextTokens.mockResolvedValue([
        { id: BigInt(1) },
        { id: BigInt(2) },
      ] as never);

      await expect(
        service.sellerReorderProductCustomTextTokens(BigInt(1), {
          templateId: '1',
          tokenIds: ['1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
