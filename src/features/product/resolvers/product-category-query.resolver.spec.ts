import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductCategoryQueryResolver } from '@/features/product/resolvers/product-category-query.resolver';
import { ProductCategoryService } from '@/features/product/services/product-category.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createCategory } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 필터/정렬 세부 검증은 service.spec.ts에서 담당.
 */
describe('ProductCategory Query Resolver (real DB)', () => {
  let resolver: ProductCategoryQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ProductCategoryQueryResolver,
        ProductCategoryService,
        ProductRepository,
      ],
    });
    resolver = module.get(ProductCategoryQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('categories: 서비스에 위임해 카테고리 목록을 반환한다', async () => {
    await createCategory(prisma, { category_type: 'EVENT', name: '생일' });

    const result = await resolver.categories({ type: 'EVENT' });

    expect(result.map((c) => c.name)).toEqual(['생일']);
  });
});
