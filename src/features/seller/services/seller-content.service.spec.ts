import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditActionType, AuditTargetType } from '@prisma/client';

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

  const NOW = new Date('2026-03-30T00:00:00.000Z');

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

  describe('sellerFaqTopics', () => {
    it('매장의 FAQ 토픽 목록을 반환해야 한다', async () => {
      const faqRows = [
        {
          id: BigInt(10),
          store_id: BigInt(100),
          title: 'FAQ 1',
          answer_html: '<p>답변1</p>',
          sort_order: 0,
          is_active: true,
          created_at: NOW,
          updated_at: NOW,
        },
        {
          id: BigInt(11),
          store_id: BigInt(100),
          title: 'FAQ 2',
          answer_html: '<p>답변2</p>',
          sort_order: 1,
          is_active: false,
          created_at: NOW,
          updated_at: NOW,
        },
      ];
      repo.listFaqTopics.mockResolvedValue(faqRows as never);

      const result = await service.sellerFaqTopics(BigInt(1));

      expect(repo.listFaqTopics).toHaveBeenCalledWith(BigInt(100));
      expect(result).toEqual([
        {
          id: '10',
          storeId: '100',
          title: 'FAQ 1',
          answerHtml: '<p>답변1</p>',
          sortOrder: 0,
          isActive: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: '11',
          storeId: '100',
          title: 'FAQ 2',
          answerHtml: '<p>답변2</p>',
          sortOrder: 1,
          isActive: false,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
    });
  });

  describe('sellerCreateFaqTopic', () => {
    it('FAQ 토픽을 생성하고 감사 로그를 기록해야 한다', async () => {
      const createdRow = {
        id: BigInt(20),
        store_id: BigInt(100),
        title: '새 FAQ',
        answer_html: '<p>새 답변</p>',
        sort_order: 0,
        is_active: true,
        created_at: NOW,
        updated_at: NOW,
      };
      repo.createFaqTopic.mockResolvedValue(createdRow as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerCreateFaqTopic(BigInt(1), {
        title: '새 FAQ',
        answerHtml: '<p>새 답변</p>',
      });

      expect(repo.createFaqTopic).toHaveBeenCalledWith({
        storeId: BigInt(100),
        title: '새 FAQ',
        answerHtml: '<p>새 답변</p>',
        sortOrder: 0,
        isActive: true,
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.STORE,
        targetId: BigInt(100),
        action: AuditActionType.CREATE,
        afterJson: { topicId: '20' },
      });
      expect(result).toEqual({
        id: '20',
        storeId: '100',
        title: '새 FAQ',
        answerHtml: '<p>새 답변</p>',
        sortOrder: 0,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
  });

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

    it('FAQ 토픽을 수정하고 감사 로그를 기록해야 한다', async () => {
      const currentRow = {
        id: BigInt(10),
        store_id: BigInt(100),
        title: '기존 제목',
        answer_html: '<p>기존 답변</p>',
        sort_order: 0,
        is_active: true,
        created_at: NOW,
        updated_at: NOW,
      };
      const updatedRow = {
        ...currentRow,
        title: '수정된 제목',
        updated_at: new Date('2026-03-30T01:00:00.000Z'),
      };
      repo.findFaqTopicById.mockResolvedValue(currentRow as never);
      repo.updateFaqTopic.mockResolvedValue(updatedRow as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerUpdateFaqTopic(BigInt(1), {
        topicId: '10',
        title: '수정된 제목',
      });

      expect(repo.findFaqTopicById).toHaveBeenCalledWith({
        topicId: BigInt(10),
        storeId: BigInt(100),
      });
      expect(repo.updateFaqTopic).toHaveBeenCalledWith({
        topicId: BigInt(10),
        data: { title: '수정된 제목' },
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.STORE,
        targetId: BigInt(100),
        action: AuditActionType.UPDATE,
        afterJson: { topicId: '10' },
      });
      expect(result).toEqual({
        id: '10',
        storeId: '100',
        title: '수정된 제목',
        answerHtml: '<p>기존 답변</p>',
        sortOrder: 0,
        isActive: true,
        createdAt: NOW,
        updatedAt: new Date('2026-03-30T01:00:00.000Z'),
      });
    });
  });

  describe('sellerDeleteFaqTopic', () => {
    it('FAQ 토픽이 존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findFaqTopicById.mockResolvedValue(null);

      await expect(
        service.sellerDeleteFaqTopic(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('FAQ 토픽을 소프트 삭제하고 감사 로그를 기록해야 한다', async () => {
      const currentRow = {
        id: BigInt(10),
        store_id: BigInt(100),
        title: '삭제 대상',
        answer_html: '<p>답변</p>',
        sort_order: 0,
        is_active: true,
        created_at: NOW,
        updated_at: NOW,
      };
      repo.findFaqTopicById.mockResolvedValue(currentRow as never);
      repo.softDeleteFaqTopic.mockResolvedValue(undefined as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerDeleteFaqTopic(BigInt(1), BigInt(10));

      expect(repo.findFaqTopicById).toHaveBeenCalledWith({
        topicId: BigInt(10),
        storeId: BigInt(100),
      });
      expect(repo.softDeleteFaqTopic).toHaveBeenCalledWith(BigInt(10));
      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.STORE,
        targetId: BigInt(100),
        action: AuditActionType.DELETE,
        beforeJson: { topicId: '10' },
      });
      expect(result).toBe(true);
    });
  });

  // ─── Banner ─────────────────────────────────────────────────

  describe('sellerBanners', () => {
    it('배너 목록을 커서 기반 페이지네이션으로 반환해야 한다', async () => {
      const bannerRows = [
        {
          id: BigInt(30),
          placement: 'HOME_MAIN' as const,
          title: '배너 1',
          image_url: 'https://img.example.com/b1.png',
          link_type: 'NONE' as const,
          link_url: null,
          link_product_id: null,
          link_store_id: null,
          link_category_id: null,
          starts_at: null,
          ends_at: null,
          sort_order: 0,
          is_active: true,
          created_at: NOW,
          updated_at: NOW,
        },
      ];
      repo.listBannersByStore.mockResolvedValue(bannerRows as never);

      const result = await service.sellerBanners(BigInt(1));

      expect(repo.listBannersByStore).toHaveBeenCalledWith({
        storeId: BigInt(100),
        limit: 20,
      });
      expect(result).toEqual({
        items: [
          {
            id: '30',
            placement: 'HOME_MAIN',
            title: '배너 1',
            imageUrl: 'https://img.example.com/b1.png',
            linkType: 'NONE',
            linkUrl: null,
            linkProductId: null,
            linkStoreId: null,
            linkCategoryId: null,
            startsAt: null,
            endsAt: null,
            sortOrder: 0,
            isActive: true,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        nextCursor: null,
      });
    });
  });

  describe('sellerCreateBanner', () => {
    it('linkType이 NONE인 배너를 생성하고 감사 로그를 기록해야 한다', async () => {
      const createdRow = {
        id: BigInt(40),
        placement: 'HOME_MAIN' as const,
        title: null,
        image_url: 'https://img.example.com/new.png',
        link_type: 'NONE' as const,
        link_url: null,
        link_product_id: null,
        link_store_id: null,
        link_category_id: null,
        starts_at: null,
        ends_at: null,
        sort_order: 0,
        is_active: true,
        created_at: NOW,
        updated_at: NOW,
      };
      repo.createBanner.mockResolvedValue(createdRow as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerCreateBanner(BigInt(1), {
        placement: 'HOME_MAIN',
        imageUrl: 'https://img.example.com/new.png',
      });

      expect(repo.createBanner).toHaveBeenCalledWith({
        placement: 'HOME_MAIN',
        title: null,
        imageUrl: 'https://img.example.com/new.png',
        linkType: 'NONE',
        linkUrl: null,
        linkProductId: null,
        linkStoreId: null,
        linkCategoryId: null,
        startsAt: null,
        endsAt: null,
        sortOrder: 0,
        isActive: true,
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.STORE,
        targetId: BigInt(100),
        action: AuditActionType.CREATE,
        afterJson: { bannerId: '40' },
      });
      expect(result).toEqual({
        id: '40',
        placement: 'HOME_MAIN',
        title: null,
        imageUrl: 'https://img.example.com/new.png',
        linkType: 'NONE',
        linkUrl: null,
        linkProductId: null,
        linkStoreId: null,
        linkCategoryId: null,
        startsAt: null,
        endsAt: null,
        sortOrder: 0,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
  });

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

    it('배너를 수정하고 감사 로그를 기록해야 한다', async () => {
      const currentRow = {
        id: BigInt(30),
        placement: 'HOME_MAIN' as const,
        title: '기존 배너',
        image_url: 'https://img.example.com/old.png',
        link_type: 'NONE' as const,
        link_url: null,
        link_product_id: null,
        link_store_id: null,
        link_category_id: null,
        starts_at: null,
        ends_at: null,
        sort_order: 0,
        is_active: true,
        created_at: NOW,
        updated_at: NOW,
      };
      const updatedRow = {
        ...currentRow,
        title: '수정된 배너',
        updated_at: new Date('2026-03-30T01:00:00.000Z'),
      };
      repo.findBannerByIdForStore.mockResolvedValue(currentRow as never);
      repo.updateBanner.mockResolvedValue(updatedRow as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerUpdateBanner(BigInt(1), {
        bannerId: '30',
        title: '수정된 배너',
      });

      expect(repo.findBannerByIdForStore).toHaveBeenCalledWith({
        bannerId: BigInt(30),
        storeId: BigInt(100),
      });
      expect(repo.updateBanner).toHaveBeenCalledWith({
        bannerId: BigInt(30),
        data: { title: '수정된 배너' },
      });
      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.STORE,
        targetId: BigInt(100),
        action: AuditActionType.UPDATE,
        afterJson: { bannerId: '30' },
      });
      expect(result).toEqual({
        id: '30',
        placement: 'HOME_MAIN',
        title: '수정된 배너',
        imageUrl: 'https://img.example.com/old.png',
        linkType: 'NONE',
        linkUrl: null,
        linkProductId: null,
        linkStoreId: null,
        linkCategoryId: null,
        startsAt: null,
        endsAt: null,
        sortOrder: 0,
        isActive: true,
        createdAt: NOW,
        updatedAt: new Date('2026-03-30T01:00:00.000Z'),
      });
    });
  });

  describe('sellerDeleteBanner', () => {
    it('배너가 존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findBannerByIdForStore.mockResolvedValue(null);

      await expect(
        service.sellerDeleteBanner(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('배너를 소프트 삭제하고 감사 로그를 기록해야 한다', async () => {
      const currentRow = {
        id: BigInt(30),
        placement: 'HOME_MAIN' as const,
        title: '삭제 대상 배너',
        image_url: 'https://img.example.com/del.png',
        link_type: 'NONE' as const,
        link_url: null,
        link_product_id: null,
        link_store_id: null,
        link_category_id: null,
        starts_at: null,
        ends_at: null,
        sort_order: 0,
        is_active: true,
        created_at: NOW,
        updated_at: NOW,
      };
      repo.findBannerByIdForStore.mockResolvedValue(currentRow as never);
      repo.softDeleteBanner.mockResolvedValue(undefined as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerDeleteBanner(BigInt(1), BigInt(30));

      expect(repo.findBannerByIdForStore).toHaveBeenCalledWith({
        bannerId: BigInt(30),
        storeId: BigInt(100),
      });
      expect(repo.softDeleteBanner).toHaveBeenCalledWith(BigInt(30));
      expect(repo.createAuditLog).toHaveBeenCalledWith({
        actorAccountId: BigInt(1),
        storeId: BigInt(100),
        targetType: AuditTargetType.STORE,
        targetId: BigInt(100),
        action: AuditActionType.DELETE,
        beforeJson: { bannerId: '30' },
      });
      expect(result).toBe(true);
    });
  });

  // ─── Audit Logs ─────────────────────────────────────────────

  describe('sellerAuditLogs', () => {
    it('감사 로그 목록을 커서 기반 페이지네이션으로 반환해야 한다', async () => {
      const auditRows = [
        {
          id: BigInt(50),
          actor_account_id: BigInt(1),
          store_id: BigInt(100),
          target_type: 'STORE' as const,
          target_id: BigInt(100),
          action: 'CREATE' as const,
          before_json: null,
          after_json: { topicId: '20' },
          ip_address: '127.0.0.1',
          user_agent: 'TestAgent',
          created_at: NOW,
        },
      ];
      repo.listAuditLogsBySeller.mockResolvedValue(auditRows as never);

      const result = await service.sellerAuditLogs(BigInt(1));

      expect(repo.listAuditLogsBySeller).toHaveBeenCalledWith({
        sellerAccountId: BigInt(1),
        storeId: BigInt(100),
        limit: 20,
      });
      expect(result).toEqual({
        items: [
          {
            id: '50',
            actorAccountId: '1',
            storeId: '100',
            targetType: 'STORE',
            targetId: '100',
            action: 'CREATE',
            beforeJson: null,
            afterJson: '{"topicId":"20"}',
            ipAddress: '127.0.0.1',
            userAgent: 'TestAgent',
            createdAt: NOW,
          },
        ],
        nextCursor: null,
      });
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
