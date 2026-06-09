import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerProductTaxonomyService } from '@/features/seller/services/seller-product-taxonomy.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerProductTaxonomyService (real DB)', () => {
  let service: SellerProductTaxonomyService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerProductTaxonomyService,
        SellerRepository,
        ProductRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerProductTaxonomyService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function createSellerProduct(storeId: bigint, overrides = {}) {
    const product = await createProduct(prisma, {
      store_id: storeId,
      ...overrides,
    });
    await prisma.productImage.create({
      data: {
        product_id: product.id,
        image_url: `https://img.example/${product.id}.png`,
        sort_order: 0,
      },
    });
    return product;
  }

  describe('sellerSetProductCategories', () => {
    it('존재하지 않는 productId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerSetProductCategories(account.id, {
          productId: '999999',
          categoryIds: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('존재하지 않는 categoryId가 있으면 BadRequestException', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      await expect(
        service.sellerSetProductCategories(account.id, {
          productId: product.id.toString(),
          categoryIds: ['999999'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('카테고리 할당 + product detail에 포함', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const cat1 = await prisma.category.create({
        data: { name: '생일', category_type: 'EVENT' },
      });

      const result = await service.sellerSetProductCategories(account.id, {
        productId: product.id.toString(),
        categoryIds: [cat1.id.toString()],
      });
      expect(result.categories).toHaveLength(1);
      expect(result.categories[0].name).toBe('생일');
    });
  });

  describe('sellerSetProductTags', () => {
    it('존재하지 않는 productId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerSetProductTags(account.id, {
          productId: '999999',
          tagIds: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('존재하지 않는 tagId가 있으면 BadRequestException', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      await expect(
        service.sellerSetProductTags(account.id, {
          productId: product.id.toString(),
          tagIds: ['999999'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('태그 할당', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const tag = await prisma.tag.create({ data: { name: '레터링' } });

      const result = await service.sellerSetProductTags(account.id, {
        productId: product.id.toString(),
        tagIds: [tag.id.toString()],
      });
      expect(result.tags).toHaveLength(1);
      expect(result.tags[0].name).toBe('레터링');
    });
  });
});
