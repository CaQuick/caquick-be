import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerBannerService } from '@/features/seller/services/seller-banner.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createProduct,
  createStore,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerBannerService (real DB)', () => {
  let service: SellerBannerService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerBannerService,
        SellerRepository,
        ProductRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerBannerService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('sellerBanners', () => {
    it('자기 매장 banner만 반환한다 (link_store_id 또는 link_product 매장 필터)', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);

      await prisma.banner.create({
        data: {
          placement: 'STORE',
          image_url: 'https://i.example/1.png',
          link_type: 'STORE',
          link_store_id: me.store.id,
        },
      });
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

    it('cursor를 포함한 페이지네이션이 정상 동작한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      for (let i = 0; i < 3; i++) {
        await service.sellerCreateBanner(account.id, {
          placement: 'STORE',
          imageUrl: `https://i.example/${i}.png`,
          linkType: 'STORE',
          linkStoreId: store.id.toString(),
        });
      }

      const first = await service.sellerBanners(account.id, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await service.sellerBanners(account.id, {
        limit: 2,
        cursor: first.nextCursor as string,
      });
      expect(second.items.length).toBeGreaterThanOrEqual(1);
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

    it('linkType=STORE인데 무관한 link 필드(linkProductId/linkUrl)가 함께 들어오면 BadRequest', async () => {
      const me = await setupSellerWithStore(prisma);
      const product = await prisma.product.create({
        data: { store_id: me.store.id, name: 'p', regular_price: 1000 },
      });

      await expect(
        service.sellerCreateBanner(me.account.id, {
          placement: 'STORE',
          imageUrl: 'https://i.example/x.png',
          linkType: 'STORE',
          linkStoreId: me.store.id.toString(),
          linkProductId: product.id.toString(),
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.sellerCreateBanner(me.account.id, {
          placement: 'STORE',
          imageUrl: 'https://i.example/x.png',
          linkType: 'STORE',
          linkStoreId: me.store.id.toString(),
          linkUrl: 'https://other.example',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('linkType=NONE인데 link 필드가 들어오면 BadRequest', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateBanner(account.id, {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/x.png',
          linkType: 'NONE',
          linkUrl: 'https://x.example',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('linkType=PRODUCT + 본인 매장 product로 생성 성공', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      const result = await service.sellerCreateBanner(account.id, {
        placement: 'HOME_MAIN',
        imageUrl: 'https://i.example/p.png',
        linkType: 'PRODUCT',
        linkProductId: product.id.toString(),
      });
      expect(result.linkType).toBe('PRODUCT');
      expect(result.linkProductId).toBe(product.id.toString());
    });

    it('linkType=STORE + 본인 storeId로 생성 성공', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const result = await service.sellerCreateBanner(account.id, {
        placement: 'HOME_SUB',
        imageUrl: 'https://i.example/s.png',
        linkType: 'STORE',
        linkStoreId: store.id.toString(),
      });
      expect(result.linkType).toBe('STORE');
      expect(result.linkStoreId).toBe(store.id.toString());
    });

    it('linkType=CATEGORY + category 지정 시 생성 성공', async () => {
      const { account } = await setupSellerWithStore(prisma);
      const category = await prisma.category.create({
        data: { name: '시즌', category_type: 'EVENT' },
      });
      const result = await service.sellerCreateBanner(account.id, {
        placement: 'CATEGORY',
        imageUrl: 'https://i.example/c.png',
        linkType: 'CATEGORY',
        linkCategoryId: category.id.toString(),
      });
      expect(result.linkType).toBe('CATEGORY');
      expect(result.linkCategoryId).toBe(category.id.toString());
    });

    it('linkType=STORE + linkStoreId 누락이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateBanner(account.id, {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/x.png',
          linkType: 'STORE',
          linkStoreId: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('linkType=STORE + 타 store 지정이면 ForbiddenException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      const otherStore = await createStore(prisma);
      await expect(
        service.sellerCreateBanner(account.id, {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/x.png',
          linkType: 'STORE',
          linkStoreId: otherStore.id.toString(),
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('linkType=CATEGORY + linkCategoryId 누락이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateBanner(account.id, {
          placement: 'CATEGORY',
          imageUrl: 'https://i.example/x.png',
          linkType: 'CATEGORY',
          linkCategoryId: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('placement가 알 수 없는 값이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateBanner(account.id, {
          placement: 'UNKNOWN' as never,
          imageUrl: 'https://i.example/x.png',
          linkType: 'NONE',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('linkType이 알 수 없는 값이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateBanner(account.id, {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/x.png',
          linkType: 'INVALID' as never,
        }),
      ).rejects.toThrow(BadRequestException);
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
        startsAt: new Date('2026-05-01T00:00:00Z'),
        endsAt: new Date('2026-05-31T23:59:59Z'),
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
      expect(after.link_type).toBe('STORE');
      expect(after.link_store_id).toBe(store.id);
    });

    it('linkType 미변경 + 같은 linkType의 link 필드만 부분 업데이트는 허용된다', async () => {
      const me = await setupSellerWithStore(prisma);
      const banner = await prisma.banner.create({
        data: {
          placement: 'STORE',
          image_url: 'https://i.example/a.png',
          link_type: 'STORE',
          link_store_id: me.store.id,
        },
      });

      await service.sellerUpdateBanner(me.account.id, {
        bannerId: banner.id.toString(),
        linkStoreId: me.store.id.toString(),
      });

      const after = await prisma.banner.findUniqueOrThrow({
        where: { id: banner.id },
      });
      expect(after.link_type).toBe('STORE');
      expect(after.link_store_id).toBe(me.store.id);
    });

    it('linkType 미변경 + 무관한 link 필드(linkProductId)를 set하면 BadRequest로 거부된다', async () => {
      const me = await setupSellerWithStore(prisma);
      const product = await prisma.product.create({
        data: { store_id: me.store.id, name: 'p', regular_price: 1000 },
      });
      const banner = await prisma.banner.create({
        data: {
          placement: 'STORE',
          image_url: 'https://i.example/a.png',
          link_type: 'STORE',
          link_store_id: me.store.id,
        },
      });

      await expect(
        service.sellerUpdateBanner(me.account.id, {
          bannerId: banner.id.toString(),
          linkProductId: product.id.toString(),
        }),
      ).rejects.toThrow(BadRequestException);

      const after = await prisma.banner.findUniqueOrThrow({
        where: { id: banner.id },
      });
      expect(after.link_product_id).toBeNull();
    });

    it('linkType 미변경 + linkProductId를 null로 (falsy 분기: parseId 미호출 경로)', async () => {
      const me = await setupSellerWithStore(prisma);
      const product = await prisma.product.create({
        data: { store_id: me.store.id, name: 'p', regular_price: 1000 },
      });
      const banner = await prisma.banner.create({
        data: {
          placement: 'STORE',
          image_url: 'https://i.example/a.png',
          link_type: 'STORE',
          link_store_id: me.store.id,
          link_product_id: product.id,
        },
      });

      await service.sellerUpdateBanner(me.account.id, {
        bannerId: banner.id.toString(),
        linkProductId: null,
      });

      const after = await prisma.banner.findUniqueOrThrow({
        where: { id: banner.id },
      });
      expect(after.link_product_id).toBeNull();
      expect(after.link_type).toBe('STORE');
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
});
