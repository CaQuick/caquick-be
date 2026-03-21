import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerContentService } from '@/features/seller/services/seller-content.service';

describe('SellerContentService', () => {
  let service: SellerContentService;
  let repo: jest.Mocked<SellerRepository>;
  let productRepo: jest.Mocked<ProductRepository>;

  const SELLER_CONTEXT = {
    id: BigInt(1),
    account_type: 'SELLER',
    status: 'ACTIVE',
    store: { id: BigInt(100) },
  };

  beforeEach(async () => {
    repo = {
      findSellerAccountContext: jest.fn(),
      createAuditLog: jest.fn(),
      listFaqTopics: jest.fn(),
      createFaqTopic: jest.fn(),
      findFaqTopicById: jest.fn(),
      updateFaqTopic: jest.fn(),
      softDeleteFaqTopic: jest.fn(),
      listBannersByStore: jest.fn(),
      createBanner: jest.fn(),
      findBannerByIdForStore: jest.fn(),
      updateBanner: jest.fn(),
      softDeleteBanner: jest.fn(),
      listAuditLogsBySeller: jest.fn(),
    } as unknown as jest.Mocked<SellerRepository>;

    productRepo = {
      findProductOwnership: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerContentService,
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

    service = module.get<SellerContentService>(SellerContentService);

    // 기본: 유효한 판매자 컨텍스트 반환
    repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
  });

  // ─── FAQ Topic ────────────────────────────────────────────

  describe('sellerUpdateFaqTopic', () => {
    it('FAQ 토픽이 존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findFaqTopicById.mockResolvedValue(null);

      await expect(
        service.sellerUpdateFaqTopic(BigInt(1), {
          topicId: '999',
          title: '수정된 제목',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerDeleteFaqTopic', () => {
    it('FAQ 토픽이 존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findFaqTopicById.mockResolvedValue(null);

      await expect(
        service.sellerDeleteFaqTopic(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Banner - validateBannerOwnership ─────────────────────

  describe('validateBannerOwnership (sellerCreateBanner 경유)', () => {
    it('linkType이 URL인데 linkUrl이 없으면 BadRequestException을 던져야 한다', async () => {
      await expect(
        service.sellerCreateBanner(BigInt(1), {
          placement: 'HOME_MAIN',
          imageUrl: 'https://img.example.com/a.png',
          linkType: 'URL',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('linkType이 PRODUCT인데 linkProductId가 없으면 BadRequestException을 던져야 한다', async () => {
      await expect(
        service.sellerCreateBanner(BigInt(1), {
          placement: 'HOME_MAIN',
          imageUrl: 'https://img.example.com/a.png',
          linkType: 'PRODUCT',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('linkType이 PRODUCT인데 상품이 다른 매장 소유이면 ForbiddenException을 던져야 한다', async () => {
      productRepo.findProductOwnership.mockResolvedValue(null);

      await expect(
        service.sellerCreateBanner(BigInt(1), {
          placement: 'HOME_MAIN',
          imageUrl: 'https://img.example.com/a.png',
          linkType: 'PRODUCT',
          linkProductId: '50',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('linkType이 STORE인데 linkStoreId가 없으면 BadRequestException을 던져야 한다', async () => {
      await expect(
        service.sellerCreateBanner(BigInt(1), {
          placement: 'HOME_MAIN',
          imageUrl: 'https://img.example.com/a.png',
          linkType: 'STORE',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('linkType이 STORE인데 다른 매장의 storeId이면 ForbiddenException을 던져야 한다', async () => {
      await expect(
        service.sellerCreateBanner(BigInt(1), {
          placement: 'HOME_MAIN',
          imageUrl: 'https://img.example.com/a.png',
          linkType: 'STORE',
          linkStoreId: '999',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('linkType이 CATEGORY인데 linkCategoryId가 없으면 BadRequestException을 던져야 한다', async () => {
      await expect(
        service.sellerCreateBanner(BigInt(1), {
          placement: 'HOME_MAIN',
          imageUrl: 'https://img.example.com/a.png',
          linkType: 'CATEGORY',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Banner CRUD 예외 ─────────────────────────────────────

  describe('sellerUpdateBanner', () => {
    it('배너가 존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findBannerByIdForStore.mockResolvedValue(null);

      await expect(
        service.sellerUpdateBanner(BigInt(1), {
          bannerId: '999',
          title: '수정 배너',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerDeleteBanner', () => {
    it('배너가 존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findBannerByIdForStore.mockResolvedValue(null);

      await expect(
        service.sellerDeleteBanner(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Enum 변환 ────────────────────────────────────────────

  describe('Enum 변환 검증 (sellerCreateBanner 경유)', () => {
    it('유효하지 않은 배너 placement이면 BadRequestException을 던져야 한다', async () => {
      await expect(
        service.sellerCreateBanner(BigInt(1), {
          placement: 'INVALID_PLACEMENT' as never,
          imageUrl: 'https://img.example.com/a.png',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('유효하지 않은 배너 linkType이면 BadRequestException을 던져야 한다', async () => {
      await expect(
        service.sellerCreateBanner(BigInt(1), {
          placement: 'HOME_MAIN',
          imageUrl: 'https://img.example.com/a.png',
          linkType: 'INVALID_LINK_TYPE' as never,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
