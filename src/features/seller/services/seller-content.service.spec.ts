import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerContentService } from '@/features/seller/services/seller-content.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createProduct,
  createStore,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerContentService (real DB)', () => {
  let service: SellerContentService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [SellerContentService, SellerRepository, ProductRepository],
    });
    service = module.get(SellerContentService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── FAQ Topic ──
  describe('sellerFaqTopics', () => {
    it('매장의 FAQ 토픽을 sort_order 오름차순으로 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await prisma.storeFaqTopic.createMany({
        data: [
          {
            store_id: store.id,
            title: 'B',
            answer_html: '<p>b</p>',
            sort_order: 1,
          },
          {
            store_id: store.id,
            title: 'A',
            answer_html: '<p>a</p>',
            sort_order: 0,
          },
        ],
      });

      const result = await service.sellerFaqTopics(account.id);

      expect(result.map((r) => r.title)).toEqual(['A', 'B']);
    });

    it('soft-delete된 FAQ는 제외된다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await prisma.storeFaqTopic.create({
        data: {
          store_id: store.id,
          title: '삭제된',
          answer_html: '<p>x</p>',
          deleted_at: new Date(),
        },
      });
      await prisma.storeFaqTopic.create({
        data: { store_id: store.id, title: '활성', answer_html: '<p>o</p>' },
      });

      const result = await service.sellerFaqTopics(account.id);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('활성');
    });
  });

  describe('sellerCreateFaqTopic', () => {
    it('FAQ를 생성하고 audit log를 남긴다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);

      const result = await service.sellerCreateFaqTopic(account.id, {
        title: '새 FAQ',
        answerHtml: '<p>새 답변</p>',
      });

      expect(result.title).toBe('새 FAQ');
      const dbRow = await prisma.storeFaqTopic.findUniqueOrThrow({
        where: { id: BigInt(result.id) },
      });
      expect(dbRow.store_id).toBe(store.id);

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: store.id, action: 'CREATE' },
      });
      expect(auditLogs).toHaveLength(1);
    });
  });

  describe('sellerUpdateFaqTopic', () => {
    it('존재하지 않는 topicId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpdateFaqTopic(account.id, {
          topicId: '999999',
          title: '수정',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 매장 소유 FAQ는 NotFoundException으로 차단', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const otherFaq = await prisma.storeFaqTopic.create({
        data: {
          store_id: other.store.id,
          title: 'X',
          answer_html: '<p>x</p>',
        },
      });

      await expect(
        service.sellerUpdateFaqTopic(me.account.id, {
          topicId: otherFaq.id.toString(),
          title: '수정',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('FAQ 수정 + audit log', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const faq = await prisma.storeFaqTopic.create({
        data: { store_id: store.id, title: '구', answer_html: '<p>a</p>' },
      });

      const result = await service.sellerUpdateFaqTopic(account.id, {
        topicId: faq.id.toString(),
        title: '신',
      });

      expect(result.title).toBe('신');
      const dbRow = await prisma.storeFaqTopic.findUniqueOrThrow({
        where: { id: faq.id },
      });
      expect(dbRow.title).toBe('신');
    });
  });

  describe('sellerDeleteFaqTopic', () => {
    it('존재하지 않는 topicId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerDeleteFaqTopic(account.id, BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('soft-delete + audit log', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const faq = await prisma.storeFaqTopic.create({
        data: { store_id: store.id, title: 'x', answer_html: '<p>x</p>' },
      });

      await service.sellerDeleteFaqTopic(account.id, faq.id);

      const after = await prisma.storeFaqTopic.findUnique({
        where: { id: faq.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });
  });

  // ─── Banner ──
  describe('sellerBanners', () => {
    it('자기 매장 banner만 반환한다 (link_store_id 또는 link_product 매장 필터)', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);

      // 자기 매장 banner
      await prisma.banner.create({
        data: {
          placement: 'STORE',
          image_url: 'https://i.example/1.png',
          link_type: 'STORE',
          link_store_id: me.store.id,
        },
      });
      // 다른 매장 banner → 제외
      await prisma.banner.create({
        data: {
          placement: 'STORE',
          image_url: 'https://i.example/2.png',
          link_type: 'STORE',
          link_store_id: other.store.id,
        },
      });

      const result = await service.sellerBanners(me.account.id);
      expect(result.items).toHaveLength(1);
    });
  });

  describe('sellerCreateBanner', () => {
    it('linkType=URL인데 linkUrl 없음 → BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateBanner(account.id, {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/a.png',
          linkType: 'URL',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('linkType=PRODUCT인데 linkProductId 없음 → BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateBanner(account.id, {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/a.png',
          linkType: 'PRODUCT',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('linkType=PRODUCT인데 다른 매장 상품 → ForbiddenException', async () => {
      const me = await setupSellerWithStore(prisma);
      const otherStore = await createStore(prisma);
      const otherProduct = await createProduct(prisma, {
        store_id: otherStore.id,
      });

      await expect(
        service.sellerCreateBanner(me.account.id, {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/a.png',
          linkType: 'PRODUCT',
          linkProductId: otherProduct.id.toString(),
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('linkType=STORE인데 다른 매장 storeId → ForbiddenException', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateBanner(me.account.id, {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/a.png',
          linkType: 'STORE',
          linkStoreId: other.store.id.toString(),
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('linkType=CATEGORY인데 linkCategoryId 없음 → BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateBanner(account.id, {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/a.png',
          linkType: 'CATEGORY',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('placement enum 잘못 → BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateBanner(account.id, {
          placement: 'INVALID' as never,
          imageUrl: 'https://i.example/a.png',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('linkType enum 잘못 → BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateBanner(account.id, {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/a.png',
          linkType: 'BAD' as never,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 STORE banner 생성 + audit log', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const result = await service.sellerCreateBanner(account.id, {
        placement: 'STORE',
        imageUrl: 'https://i.example/new.png',
        linkType: 'STORE',
        linkStoreId: store.id.toString(),
      });
      expect(result.imageUrl).toBe('https://i.example/new.png');
      expect(result.linkStoreId).toBe(store.id.toString());

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: store.id, action: 'CREATE' },
      });
      expect(auditLogs).toHaveLength(1);
    });
  });

  describe('sellerUpdateBanner', () => {
    it('존재하지 않는 bannerId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpdateBanner(account.id, {
          bannerId: '999999',
          title: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('자기 매장 banner의 title을 수정한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const banner = await prisma.banner.create({
        data: {
          placement: 'STORE',
          image_url: 'https://i.example/a.png',
          link_type: 'STORE',
          link_store_id: store.id,
        },
      });

      const result = await service.sellerUpdateBanner(account.id, {
        bannerId: banner.id.toString(),
        title: '새 타이틀',
      });
      expect(result.title).toBe('새 타이틀');
    });

    it('linkType 변경: STORE → NONE이면 link_store_id 등 모든 link 필드가 null로 정리된다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const banner = await prisma.banner.create({
        data: {
          placement: 'STORE',
          image_url: 'https://i.example/a.png',
          link_type: 'STORE',
          link_store_id: store.id,
        },
      });

      await service.sellerUpdateBanner(account.id, {
        bannerId: banner.id.toString(),
        linkType: 'NONE',
      });

      const after = await prisma.banner.findUniqueOrThrow({
        where: { id: banner.id },
      });
      expect(after.link_type).toBe('NONE');
      expect(after.link_store_id).toBeNull();
      expect(after.link_url).toBeNull();
      expect(after.link_product_id).toBeNull();
      expect(after.link_category_id).toBeNull();
    });

    it('linkType 변경: STORE → URL이면 link_url만 유지되고 나머지 null', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const banner = await prisma.banner.create({
        data: {
          placement: 'STORE',
          image_url: 'https://i.example/a.png',
          link_type: 'STORE',
          link_store_id: store.id,
        },
      });

      await service.sellerUpdateBanner(account.id, {
        bannerId: banner.id.toString(),
        linkType: 'URL',
        linkUrl: 'https://external.example',
      });

      const after = await prisma.banner.findUniqueOrThrow({
        where: { id: banner.id },
      });
      expect(after.link_type).toBe('URL');
      expect(after.link_url).toBe('https://external.example');
      expect(after.link_store_id).toBeNull();
    });

    it('linkType 미변경 + 비-link 필드만 업데이트 (else branch 커버)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const banner = await prisma.banner.create({
        data: {
          placement: 'STORE',
          image_url: 'https://i.example/a.png',
          link_type: 'STORE',
          link_store_id: store.id,
        },
      });

      await service.sellerUpdateBanner(account.id, {
        bannerId: banner.id.toString(),
        placement: 'HOME_MAIN',
        imageUrl: 'https://i.example/new.png',
        sortOrder: 7,
        isActive: false,
        startsAt: '2026-05-01T00:00:00Z',
        endsAt: '2026-05-31T23:59:59Z',
      });

      const after = await prisma.banner.findUniqueOrThrow({
        where: { id: banner.id },
      });
      expect(after.placement).toBe('HOME_MAIN');
      expect(after.image_url).toBe('https://i.example/new.png');
      expect(after.sort_order).toBe(7);
      expect(after.is_active).toBe(false);
      expect(after.starts_at).not.toBeNull();
      expect(after.ends_at).not.toBeNull();
      // linkType이 변경되지 않았으므로 기존 STORE 링크는 그대로 유지
      expect(after.link_type).toBe('STORE');
      expect(after.link_store_id).toBe(store.id);
    });
  });

  describe('sellerDeleteBanner', () => {
    it('존재하지 않으면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerDeleteBanner(account.id, BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('soft-delete + audit log', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const banner = await prisma.banner.create({
        data: {
          placement: 'STORE',
          image_url: 'https://i.example/a.png',
          link_type: 'STORE',
          link_store_id: store.id,
        },
      });

      await service.sellerDeleteBanner(account.id, banner.id);

      const after = await prisma.banner.findUnique({
        where: { id: banner.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });
  });

  describe('sellerAuditLogs', () => {
    it('판매자 컨텍스트의 audit log를 cursor 페이지네이션으로 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      // FAQ 생성 → audit log 1건 자동 생성
      await service.sellerCreateFaqTopic(account.id, {
        title: 'F',
        answerHtml: '<p>x</p>',
      });

      const result = await service.sellerAuditLogs(account.id);
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items[0].storeId).toBe(store.id.toString());
    });

    it('targetType 필터링이 동작한다', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await service.sellerCreateFaqTopic(account.id, {
        title: 'F',
        answerHtml: '<p>x</p>',
      });

      const filtered = await service.sellerAuditLogs(account.id, {
        targetType: 'STORE',
      });
      expect(filtered.items.every((it) => it.targetType === 'STORE')).toBe(
        true,
      );
    });

    it('잘못된 targetType이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerAuditLogs(account.id, {
          targetType: 'INVALID' as never,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
