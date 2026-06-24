import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductStorefrontQueryResolver } from '@/features/product/resolvers/product-storefront-query.resolver';
import { ProductStorefrontService } from '@/features/product/services/product-storefront.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 분기/필터 세부 검증은 service.spec.ts에서 담당.
 */
describe('ProductStorefront Query Resolver (real DB)', () => {
  let resolver: ProductStorefrontQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ProductStorefrontQueryResolver,
        ProductStorefrontService,
        ProductRepository,
      ],
    });
    resolver = module.get(ProductStorefrontQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('storeProducts: 서비스에 위임해 상품 목록을 반환한다', async () => {
    const store = await createStore(prisma);
    await createProduct(prisma, { store_id: store.id, name: '케이크' });

    const result = await resolver.storeProducts({
      storeId: store.id.toString(),
    });

    expect(result.items.map((p) => p.name)).toEqual(['케이크']);
    expect(result.hasMore).toBe(false);
  });

  it('storeProductCategories: 서비스에 위임해 카테고리를 반환한다', async () => {
    const store = await createStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });
    const category = await prisma.category.create({
      data: {
        name: '생일',
        category_type: 'EVENT',
        sort_order: 0,
        is_active: true,
      },
    });
    await prisma.productCategory.create({
      data: { product_id: product.id, category_id: category.id },
    });

    const result = await resolver.storeProductCategories(store.id.toString());

    expect(result.map((c) => c.name)).toEqual(['생일']);
  });
});
