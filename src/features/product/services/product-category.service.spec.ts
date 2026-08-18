import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductCategoryService } from '@/features/product/services/product-category.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createCategory } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('ProductCategoryService (real DB)', () => {
  let service: ProductCategoryService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ProductCategoryService, ProductRepository],
    });
    service = module.get(ProductCategoryService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('categories', () => {
    it('type 미지정 시 전체 카테고리를 type→sort_order 순으로 반환한다', async () => {
      await createCategory(prisma, {
        category_type: 'STYLE',
        name: '꽃장식',
        sort_order: 0,
      });
      await createCategory(prisma, {
        category_type: 'EVENT',
        name: '크리스마스',
        sort_order: 1,
      });
      await createCategory(prisma, {
        category_type: 'EVENT',
        name: '생일',
        sort_order: 0,
      });

      const result = await service.categories();

      expect(result.map((c) => c.name)).toEqual([
        '생일',
        '크리스마스',
        '꽃장식',
      ]);
      expect(result.map((c) => c.categoryType)).toEqual([
        'EVENT',
        'EVENT',
        'STYLE',
      ]);
    });

    it('type 지정 시 해당 타입만 반환한다', async () => {
      await createCategory(prisma, { category_type: 'EVENT', name: '생일' });
      await createCategory(prisma, { category_type: 'STYLE', name: '입체' });

      const result = await service.categories({ type: 'STYLE' });

      expect(result.map((c) => c.name)).toEqual(['입체']);
    });

    it('비활성/soft-delete 카테고리는 제외한다', async () => {
      await createCategory(prisma, { name: '활성', sort_order: 0 });
      await createCategory(prisma, {
        name: '비활성',
        sort_order: 1,
        is_active: false,
      });
      await createCategory(prisma, {
        name: '삭제됨',
        sort_order: 2,
        deleted_at: new Date(),
      });

      const result = await service.categories();

      expect(result.map((c) => c.name)).toEqual(['활성']);
    });

    it('카테고리가 없으면 빈 배열을 반환한다', async () => {
      await expect(service.categories()).resolves.toEqual([]);
    });

    it('id와 sortOrder를 문자열/숫자로 매핑한다', async () => {
      const category = await createCategory(prisma, {
        name: '생일',
        sort_order: 3,
      });

      const [item] = await service.categories();

      expect(item.id).toBe(category.id.toString());
      expect(item.sortOrder).toBe(3);
    });
  });
});
