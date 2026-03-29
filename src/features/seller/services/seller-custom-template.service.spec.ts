import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditActionType, AuditTargetType } from '@prisma/client';

import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';

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

    it('유효한 입력으로 커스텀 템플릿을 upsert하고 결과를 반환해야 한다', async () => {
      productRepo.findProductByIdIncludingInactive.mockResolvedValue({
        id: BigInt(10),
      } as never);

      const upsertedRow = {
        id: BigInt(20),
        product_id: BigInt(10),
        base_image_url: 'https://example.com/base.png',
        is_active: true,
        text_tokens: [],
      };
      productRepo.upsertProductCustomTemplate.mockResolvedValue(
        upsertedRow as never,
      );

      const result = await service.sellerUpsertProductCustomTemplate(
        BigInt(1),
        {
          productId: '10',
          baseImageUrl: 'https://example.com/base.png',
        },
      );

      expect(result).toEqual({
        id: '20',
        productId: '10',
        baseImageUrl: 'https://example.com/base.png',
        isActive: true,
        textTokens: [],
      });

      expect(productRepo.upsertProductCustomTemplate).toHaveBeenCalledWith({
        productId: BigInt(10),
        baseImageUrl: 'https://example.com/base.png',
        isActive: true,
      });

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.UPDATE,
        afterJson: { templateId: '20' },
      });
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

    it('유효한 입력으로 템플릿 활성 상태를 변경하고 결과를 반환해야 한다', async () => {
      productRepo.findCustomTemplateById.mockResolvedValue({
        id: BigInt(20),
        product_id: BigInt(10),
        product: { store_id: BigInt(100) },
      } as never);

      const updatedRow = {
        id: BigInt(20),
        product_id: BigInt(10),
        base_image_url: 'https://example.com/base.png',
        is_active: false,
        text_tokens: [],
      };
      productRepo.setCustomTemplateActive.mockResolvedValue(
        updatedRow as never,
      );

      const result = await service.sellerSetProductCustomTemplateActive(
        BigInt(1),
        {
          templateId: '20',
          isActive: false,
        },
      );

      expect(result).toEqual({
        id: '20',
        productId: '10',
        baseImageUrl: 'https://example.com/base.png',
        isActive: false,
        textTokens: [],
      });

      expect(productRepo.setCustomTemplateActive).toHaveBeenCalledWith(
        BigInt(20),
        false,
      );

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.STATUS_CHANGE,
        afterJson: { templateId: '20', isActive: false },
      });
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

    it('tokenId 없이 새 토큰을 생성하고 결과를 반환해야 한다', async () => {
      productRepo.findCustomTemplateById.mockResolvedValue({
        id: BigInt(20),
        product_id: BigInt(10),
        product: { store_id: BigInt(100) },
      } as never);

      const createdRow = {
        id: BigInt(40),
        template_id: BigInt(20),
        token_key: 'NAME',
        default_text: '이름을 입력하세요',
        max_length: 50,
        sort_order: 0,
        is_required: true,
        pos_x: null,
        pos_y: null,
        width: null,
        height: null,
      };
      productRepo.upsertCustomTextToken.mockResolvedValue(createdRow as never);

      const result = await service.sellerUpsertProductCustomTextToken(
        BigInt(1),
        {
          templateId: '20',
          tokenKey: 'NAME',
          defaultText: '이름을 입력하세요',
          maxLength: 50,
        },
      );

      expect(result).toEqual({
        id: '40',
        templateId: '20',
        tokenKey: 'NAME',
        defaultText: '이름을 입력하세요',
        maxLength: 50,
        sortOrder: 0,
        isRequired: true,
        posX: null,
        posY: null,
        width: null,
        height: null,
      });

      expect(productRepo.upsertCustomTextToken).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenId: undefined,
          templateId: BigInt(20),
          tokenKey: 'NAME',
          defaultText: '이름을 입력하세요',
          maxLength: 50,
        }),
      );

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.CREATE,
        afterJson: { tokenId: '40', tokenKey: 'NAME' },
      });
    });

    it('tokenId가 있으면 기존 토큰을 업데이트하고 결과를 반환해야 한다', async () => {
      productRepo.findCustomTemplateById.mockResolvedValue({
        id: BigInt(20),
        product_id: BigInt(10),
        product: { store_id: BigInt(100) },
      } as never);
      productRepo.findCustomTextTokenById.mockResolvedValue({
        id: BigInt(40),
        template: {
          id: BigInt(20),
          product: { store_id: BigInt(100) },
        },
      } as never);

      const updatedRow = {
        id: BigInt(40),
        template_id: BigInt(20),
        token_key: 'UPDATED_NAME',
        default_text: '수정된 기본값',
        max_length: 100,
        sort_order: 1,
        is_required: false,
        pos_x: 10,
        pos_y: 20,
        width: 200,
        height: 50,
      };
      productRepo.upsertCustomTextToken.mockResolvedValue(updatedRow as never);

      const result = await service.sellerUpsertProductCustomTextToken(
        BigInt(1),
        {
          templateId: '20',
          tokenId: '40',
          tokenKey: 'UPDATED_NAME',
          defaultText: '수정된 기본값',
          maxLength: 100,
          sortOrder: 1,
          isRequired: false,
          posX: 10,
          posY: 20,
          width: 200,
          height: 50,
        },
      );

      expect(result).toEqual({
        id: '40',
        templateId: '20',
        tokenKey: 'UPDATED_NAME',
        defaultText: '수정된 기본값',
        maxLength: 100,
        sortOrder: 1,
        isRequired: false,
        posX: 10,
        posY: 20,
        width: 200,
        height: 50,
      });

      expect(productRepo.upsertCustomTextToken).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenId: BigInt(40),
          templateId: BigInt(20),
          tokenKey: 'UPDATED_NAME',
          defaultText: '수정된 기본값',
          maxLength: 100,
          sortOrder: 1,
          isRequired: false,
          posX: 10,
          posY: 20,
          width: 200,
          height: 50,
        }),
      );

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.UPDATE,
        afterJson: { tokenId: '40', tokenKey: 'UPDATED_NAME' },
      });
    });
  });

  describe('sellerDeleteProductCustomTextToken', () => {
    it('토큰이 없으면 NotFoundException을 던져야 한다', async () => {
      productRepo.findCustomTextTokenById.mockResolvedValue(null as never);

      await expect(
        service.sellerDeleteProductCustomTextToken(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('유효한 토큰을 소프트 삭제하고 true를 반환해야 한다', async () => {
      productRepo.findCustomTextTokenById.mockResolvedValue({
        id: BigInt(40),
        token_key: 'NAME',
        template: {
          product_id: BigInt(10),
          product: { store_id: BigInt(100) },
        },
      } as never);
      productRepo.softDeleteCustomTextToken.mockResolvedValue(
        undefined as never,
      );

      const result = await service.sellerDeleteProductCustomTextToken(
        BigInt(1),
        BigInt(40),
      );

      expect(result).toBe(true);

      expect(productRepo.softDeleteCustomTextToken).toHaveBeenCalledWith(
        BigInt(40),
      );

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.DELETE,
        beforeJson: { tokenId: '40', tokenKey: 'NAME' },
      });
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

    it('유효한 입력으로 토큰을 정렬하고 결과를 반환해야 한다', async () => {
      productRepo.findCustomTemplateById.mockResolvedValue({
        id: BigInt(20),
        product_id: BigInt(10),
        product: { store_id: BigInt(100) },
      } as never);
      productRepo.listCustomTextTokens.mockResolvedValue([
        { id: BigInt(40) },
        { id: BigInt(41) },
      ] as never);

      const reorderedRows = [
        {
          id: BigInt(41),
          template_id: BigInt(20),
          token_key: 'MESSAGE',
          default_text: '메시지를 입력하세요',
          max_length: 200,
          sort_order: 0,
          is_required: false,
          pos_x: null,
          pos_y: null,
          width: null,
          height: null,
        },
        {
          id: BigInt(40),
          template_id: BigInt(20),
          token_key: 'NAME',
          default_text: '이름을 입력하세요',
          max_length: 50,
          sort_order: 1,
          is_required: true,
          pos_x: 10,
          pos_y: 20,
          width: 100,
          height: 30,
        },
      ];
      productRepo.reorderCustomTextTokens.mockResolvedValue(
        reorderedRows as never,
      );

      const result = await service.sellerReorderProductCustomTextTokens(
        BigInt(1),
        {
          templateId: '20',
          tokenIds: ['41', '40'],
        },
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('41');
      expect(result[0].tokenKey).toBe('MESSAGE');
      expect(result[1].id).toBe('40');
      expect(result[1].tokenKey).toBe('NAME');

      expect(productRepo.reorderCustomTextTokens).toHaveBeenCalledWith({
        templateId: BigInt(20),
        tokenIds: [BigInt(41), BigInt(40)],
      });

      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.PRODUCT,
        targetId: BigInt(10),
        action: AuditActionType.UPDATE,
        afterJson: { tokenIds: ['41', '40'] },
      });
    });
  });
});
