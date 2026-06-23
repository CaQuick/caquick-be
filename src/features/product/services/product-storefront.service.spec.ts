import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductStorefrontService } from '@/features/product/services/product-storefront.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

async function addCategory(
  prisma: PrismaClient,
  productId: bigint,
  opts: { name: string; sortOrder?: number },
): Promise<bigint> {
  const category = await prisma.category.create({
    data: {
      name: opts.name,
      category_type: 'EVENT',
      sort_order: opts.sortOrder ?? 0,
      is_active: true,
    },
  });
  await prisma.productCategory.create({
    data: { product_id: productId, category_id: category.id },
  });
  return category.id;
}

describe('ProductStorefrontService (real DB)', () => {
  let service: ProductStorefrontService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ProductStorefrontService, ProductRepository],
    });
    service = module.get(ProductStorefrontService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('storeProducts', () => {
    it('활성 상품만 반환하고 비활성/삭제 상품은 제외한다', async () => {
      const store = await createStore(prisma);
      await createProduct(prisma, { store_id: store.id, name: '활성' });
      await createProduct(prisma, {
        store_id: store.id,
        name: '비활성',
        is_active: false,
      });
      const deleted = await createProduct(prisma, {
        store_id: store.id,
        name: '삭제',
      });
      await prisma.product.update({
        where: { id: deleted.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.storeProducts({
        storeId: store.id.toString(),
      });

      expect(result.items.map((p) => p.name)).toEqual(['활성']);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('매장이 비활성이면 빈 결과', async () => {
      const store = await createStore(prisma, { is_active: false });
      await createProduct(prisma, { store_id: store.id });

      const result = await service.storeProducts({
        storeId: store.id.toString(),
      });

      expect(result.items).toEqual([]);
    });

    it('대표 이미지(sort_order 최소)와 할인율을 채운다', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, {
        store_id: store.id,
        regular_price: 40000,
        sale_price: 35000,
      });
      await prisma.productImage.create({
        data: { product_id: product.id, image_url: 'b.png', sort_order: 1 },
      });
      await prisma.productImage.create({
        data: { product_id: product.id, image_url: 'a.png', sort_order: 0 },
      });

      const result = await service.storeProducts({
        storeId: store.id.toString(),
      });

      expect(result.items[0].thumbnailUrl).toBe('a.png');
      expect(result.items[0].discountRate).toBe(13);
    });

    it('categoryId로 필터한다', async () => {
      const store = await createStore(prisma);
      const p1 = await createProduct(prisma, {
        store_id: store.id,
        name: '생일',
      });
      const p2 = await createProduct(prisma, {
        store_id: store.id,
        name: '돌잔치',
      });
      const birthdayId = await addCategory(prisma, p1.id, {
        name: '생일 케이크',
      });
      await addCategory(prisma, p2.id, { name: '돌잔치 케이크' });

      const result = await service.storeProducts({
        storeId: store.id.toString(),
        categoryId: birthdayId.toString(),
      });

      expect(result.items.map((p) => p.name)).toEqual(['생일']);
    });

    it('search로 상품명·태그를 부분일치 검색한다', async () => {
      const store = await createStore(prisma);
      await createProduct(prisma, {
        store_id: store.id,
        name: '강아지 케이크',
      });
      const tagged = await createProduct(prisma, {
        store_id: store.id,
        name: '미니 케이크',
      });
      const tag = await prisma.tag.create({ data: { name: '강아지' } });
      await prisma.productTag.create({
        data: { product_id: tagged.id, tag_id: tag.id },
      });
      await createProduct(prisma, {
        store_id: store.id,
        name: '초콜릿 케이크',
      });

      const result = await service.storeProducts({
        storeId: store.id.toString(),
        search: '강아지',
      });

      expect(result.items.map((p) => p.name).sort()).toEqual([
        '강아지 케이크',
        '미니 케이크',
      ]);
    });

    it('커서 페이지네이션으로 hasMore/nextCursor를 처리한다', async () => {
      const store = await createStore(prisma);
      for (let i = 0; i < 3; i++) {
        await createProduct(prisma, { store_id: store.id, name: `P${i}` });
      }

      const first = await service.storeProducts({
        storeId: store.id.toString(),
        limit: 2,
      });
      expect(first.items).toHaveLength(2);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).not.toBeNull();

      const second = await service.storeProducts({
        storeId: store.id.toString(),
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });
      expect(second.items).toHaveLength(1);
      expect(second.hasMore).toBe(false);
      expect(second.nextCursor).toBeNull();
    });
  });

  describe('storeProductCategories', () => {
    it('매장 보유 카테고리만 sort_order 순으로, productCount와 함께 반환한다', async () => {
      const store = await createStore(prisma);
      const p1 = await createProduct(prisma, { store_id: store.id });
      const p2 = await createProduct(prisma, { store_id: store.id });

      const birthday = await prisma.category.create({
        data: {
          name: '생일',
          category_type: 'EVENT',
          sort_order: 2,
          is_active: true,
        },
      });
      const dol = await prisma.category.create({
        data: {
          name: '돌잔치',
          category_type: 'EVENT',
          sort_order: 1,
          is_active: true,
        },
      });
      // 어떤 상품도 속하지 않은 빈 카테고리(제외돼야 함)
      await prisma.category.create({
        data: {
          name: '크리스마스',
          category_type: 'EVENT',
          sort_order: 3,
          is_active: true,
        },
      });
      await prisma.productCategory.create({
        data: { product_id: p1.id, category_id: birthday.id },
      });
      await prisma.productCategory.create({
        data: { product_id: p2.id, category_id: birthday.id },
      });
      await prisma.productCategory.create({
        data: { product_id: p1.id, category_id: dol.id },
      });

      const result = await service.storeProductCategories(store.id.toString());

      expect(result.map((c) => c.name)).toEqual(['돌잔치', '생일']);
      expect(result.find((c) => c.name === '생일')?.productCount).toBe(2);
      expect(result.find((c) => c.name === '돌잔치')?.productCount).toBe(1);
    });

    it('비활성 상품의 카테고리는 제외한다', async () => {
      const store = await createStore(prisma);
      const inactive = await createProduct(prisma, {
        store_id: store.id,
        is_active: false,
      });
      const cat = await prisma.category.create({
        data: {
          name: '생일',
          category_type: 'EVENT',
          sort_order: 0,
          is_active: true,
        },
      });
      await prisma.productCategory.create({
        data: { product_id: inactive.id, category_id: cat.id },
      });

      const result = await service.storeProductCategories(store.id.toString());

      expect(result).toEqual([]);
    });
  });
});
