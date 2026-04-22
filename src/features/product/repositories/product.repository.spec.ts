import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('ProductRepository (real DB)', () => {
  let repo: ProductRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ProductRepository],
    });
    repo = module.get(ProductRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function createCategory(name = '생일') {
    return prisma.category.create({
      data: { name, category_type: 'EVENT' },
    });
  }

  async function createTag(name = '레터링') {
    return prisma.tag.create({ data: { name } });
  }

  async function createOptionGroup(productId: bigint, sortOrder = 0) {
    return prisma.productOptionGroup.create({
      data: { product_id: productId, name: '사이즈', sort_order: sortOrder },
    });
  }

  async function createOptionItem(optionGroupId: bigint, sortOrder = 0) {
    return prisma.productOptionItem.create({
      data: {
        option_group_id: optionGroupId,
        title: 'T',
        sort_order: sortOrder,
      },
    });
  }

  async function createTemplate(productId: bigint) {
    return prisma.productCustomTemplate.create({
      data: {
        product_id: productId,
        base_image_url: 'https://i.example/base.png',
      },
    });
  }

  // ─── Product list/fetch ──
  describe('listProductsByStore', () => {
    it('store_id 필터 + cursor 페이지네이션', async () => {
      const storeA = await createStore(prisma);
      const storeB = await createStore(prisma);
      const p1 = await createProduct(prisma, { store_id: storeA.id });
      const p2 = await createProduct(prisma, { store_id: storeA.id });
      await createProduct(prisma, { store_id: storeB.id });

      const rows = await repo.listProductsByStore({
        storeId: storeA.id,
        limit: 10,
      });
      expect(rows.map((r) => r.id).sort()).toEqual([p1.id, p2.id].sort());

      const page2 = await repo.listProductsByStore({
        storeId: storeA.id,
        limit: 10,
        cursor: p2.id,
      });
      expect(page2.map((r) => r.id)).toEqual([p1.id]);
    });

    it('isActive 필터', async () => {
      const store = await createStore(prisma);
      await createProduct(prisma, { store_id: store.id, is_active: true });
      await createProduct(prisma, { store_id: store.id, is_active: false });

      const active = await repo.listProductsByStore({
        storeId: store.id,
        limit: 10,
        isActive: true,
      });
      expect(active).toHaveLength(1);
      expect(active[0].is_active).toBe(true);
    });

    it('categoryId 필터: product_categories join', async () => {
      const store = await createStore(prisma);
      const cat = await createCategory();
      const pInCat = await createProduct(prisma, { store_id: store.id });
      await createProduct(prisma, { store_id: store.id });
      await prisma.productCategory.create({
        data: { product_id: pInCat.id, category_id: cat.id },
      });

      const rows = await repo.listProductsByStore({
        storeId: store.id,
        limit: 10,
        categoryId: cat.id,
      });
      expect(rows.map((r) => r.id)).toEqual([pInCat.id]);
    });

    it('search: 이름 또는 태그 이름 contains 매칭', async () => {
      const store = await createStore(prisma);
      const pByName = await createProduct(prisma, {
        store_id: store.id,
        name: '바닐라 케이크',
      });
      const pByTag = await createProduct(prisma, {
        store_id: store.id,
        name: '다른 이름',
      });
      const tag = await createTag('레터링');
      await prisma.productTag.create({
        data: { product_id: pByTag.id, tag_id: tag.id },
      });

      const byName = await repo.listProductsByStore({
        storeId: store.id,
        limit: 10,
        search: '바닐라',
      });
      expect(byName.map((r) => r.id)).toEqual([pByName.id]);

      const byTag = await repo.listProductsByStore({
        storeId: store.id,
        limit: 10,
        search: '레터링',
      });
      expect(byTag.map((r) => r.id)).toEqual([pByTag.id]);
    });

    it('include는 images/categories/tags/option_groups(items)/custom_template(text_tokens)까지 로딩', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      await prisma.productImage.create({
        data: {
          product_id: product.id,
          image_url: 'https://i.example/1.png',
          sort_order: 0,
        },
      });
      const cat = await createCategory();
      await prisma.productCategory.create({
        data: { product_id: product.id, category_id: cat.id },
      });
      const tag = await createTag();
      await prisma.productTag.create({
        data: { product_id: product.id, tag_id: tag.id },
      });
      const group = await createOptionGroup(product.id);
      await createOptionItem(group.id);
      const tpl = await createTemplate(product.id);
      await prisma.productCustomTextToken.create({
        data: { template_id: tpl.id, token_key: 'K', default_text: 'V' },
      });

      const rows = await repo.listProductsByStore({
        storeId: store.id,
        limit: 10,
      });
      const row = rows[0];
      expect(row.images).toHaveLength(1);
      expect(row.product_categories[0].category.name).toBe('생일');
      expect(row.product_tags[0].tag.name).toBe('레터링');
      expect(row.option_groups[0].option_items).toHaveLength(1);
      expect(row.custom_template?.text_tokens).toHaveLength(1);
    });
  });

  describe('findProductById (active만)', () => {
    it('is_active: false면 반환 안함', async () => {
      const store = await createStore(prisma);
      const inactive = await createProduct(prisma, {
        store_id: store.id,
        is_active: false,
      });
      const result = await repo.findProductById({
        productId: inactive.id,
        storeId: store.id,
      });
      expect(result).toBeNull();
    });

    it('store_id 불일치면 null', async () => {
      const storeA = await createStore(prisma);
      const storeB = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: storeA.id });

      const result = await repo.findProductById({
        productId: product.id,
        storeId: storeB.id,
      });
      expect(result).toBeNull();
    });
  });

  describe('findProductByIdIncludingInactive', () => {
    it('inactive 상품도 반환', async () => {
      const store = await createStore(prisma);
      const inactive = await createProduct(prisma, {
        store_id: store.id,
        is_active: false,
      });
      const result = await repo.findProductByIdIncludingInactive({
        productId: inactive.id,
        storeId: store.id,
      });
      expect(result?.id).toBe(inactive.id);
    });
  });

  // ─── Product CRUD ──
  describe('createProduct / updateProduct / softDeleteProduct', () => {
    it('createProduct는 store_id를 결합하여 생성', async () => {
      const store = await createStore(prisma);
      const result = await repo.createProduct({
        storeId: store.id,
        data: {
          name: '신상',
          regular_price: 10000,
          currency: 'KRW',
          is_active: true,
        },
      });
      expect(result.store_id).toBe(store.id);
      expect(result.name).toBe('신상');
    });

    it('updateProduct는 주어진 필드만 갱신하고 나머지는 유지한다', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, {
        store_id: store.id,
        name: '구',
        regular_price: 15000,
        is_active: true,
      });
      const result = await repo.updateProduct({
        productId: product.id,
        data: { name: '신' },
      });
      expect(result.name).toBe('신');
      expect(result.regular_price).toBe(15000);
      expect(result.is_active).toBe(true);
      expect(result.store_id).toBe(store.id);
    });

    it('softDeleteProduct는 deleted_at + is_active:false', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      await repo.softDeleteProduct(product.id);

      const after = await prisma.product.findUnique({
        where: { id: product.id },
      });
      expect(after?.deleted_at).not.toBeNull();
      expect(after?.is_active).toBe(false);
    });
  });

  // ─── Images ──
  describe('Product images', () => {
    it('countProductImages + addProductImage + listProductImages', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      expect(await repo.countProductImages(product.id)).toBe(0);
      await repo.addProductImage({
        productId: product.id,
        imageUrl: 'https://i.example/1.png',
        sortOrder: 0,
      });
      expect(await repo.countProductImages(product.id)).toBe(1);

      const list = await repo.listProductImages(product.id);
      expect(list).toHaveLength(1);
    });

    it('findProductImageById + softDeleteProductImage', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const image = await prisma.productImage.create({
        data: {
          product_id: product.id,
          image_url: 'https://i.example/a.png',
          sort_order: 0,
        },
      });

      const found = await repo.findProductImageById(image.id);
      expect(found?.product.store_id).toBe(store.id);

      await repo.softDeleteProductImage(image.id);
      const after = await prisma.productImage.findUnique({
        where: { id: image.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });

    it('reorderProductImages: sort_order 재할당 (트랜잭션)', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const img1 = await prisma.productImage.create({
        data: { product_id: product.id, image_url: 'a', sort_order: 0 },
      });
      const img2 = await prisma.productImage.create({
        data: { product_id: product.id, image_url: 'b', sort_order: 1 },
      });
      const img3 = await prisma.productImage.create({
        data: { product_id: product.id, image_url: 'c', sort_order: 2 },
      });

      const result = await repo.reorderProductImages({
        productId: product.id,
        imageIds: [img3.id, img1.id, img2.id],
      });
      expect(result.map((r) => r.id)).toEqual([img3.id, img1.id, img2.id]);
      // 정렬 결과뿐 아니라 sort_order 값 자체가 0,1,2로 재할당됐는지 확인
      const sortOrderByImage = new Map(
        (
          await prisma.productImage.findMany({
            where: { product_id: product.id },
          })
        ).map((r) => [r.id, r.sort_order]),
      );
      expect(sortOrderByImage.get(img3.id)).toBe(0);
      expect(sortOrderByImage.get(img1.id)).toBe(1);
      expect(sortOrderByImage.get(img2.id)).toBe(2);
    });
  });

  // ─── Category / Tag ──
  describe('findCategoryIds / findTagIds / replaceProduct*', () => {
    it('findCategoryIds는 존재하는 id만 반환', async () => {
      const cat = await createCategory();
      const result = await repo.findCategoryIds([cat.id, BigInt(999999)]);
      expect(result.map((r) => r.id)).toEqual([cat.id]);
    });

    it('findTagIds는 존재하는 id만 반환', async () => {
      const tag = await createTag();
      const result = await repo.findTagIds([tag.id, BigInt(999999)]);
      expect(result.map((r) => r.id)).toEqual([tag.id]);
    });

    it('replaceProductCategories: 기존 관계 제거 후 신규 생성', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const cat1 = await createCategory('A');
      const cat2 = await createCategory('B');

      await repo.replaceProductCategories({
        productId: product.id,
        categoryIds: [cat1.id],
      });
      let rows = await prisma.productCategory.findMany({
        where: { product_id: product.id },
      });
      expect(rows.map((r) => r.category_id)).toEqual([cat1.id]);

      // 교체
      await repo.replaceProductCategories({
        productId: product.id,
        categoryIds: [cat2.id],
      });
      rows = await prisma.productCategory.findMany({
        where: { product_id: product.id },
      });
      expect(rows.map((r) => r.category_id)).toEqual([cat2.id]);

      // 빈 배열: 전부 제거
      await repo.replaceProductCategories({
        productId: product.id,
        categoryIds: [],
      });
      rows = await prisma.productCategory.findMany({
        where: { product_id: product.id },
      });
      expect(rows).toHaveLength(0);
    });

    it('replaceProductTags: 교체 동작', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const t1 = await createTag('A');
      const t2 = await createTag('B');

      await repo.replaceProductTags({
        productId: product.id,
        tagIds: [t1.id, t2.id],
      });
      const rows = await prisma.productTag.findMany({
        where: { product_id: product.id },
      });
      expect(rows).toHaveLength(2);
    });
  });

  // ─── OptionGroup / OptionItem ──
  describe('Option group/item', () => {
    it('createOptionGroup + findOptionGroupById(product.store_id 포함)', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      const group = await repo.createOptionGroup({
        productId: product.id,
        data: { name: '사이즈' },
      });

      const found = await repo.findOptionGroupById(group.id);
      expect(found?.product.store_id).toBe(store.id);
    });

    it('updateOptionGroup은 option_items include 포함', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const group = await createOptionGroup(product.id);
      await createOptionItem(group.id);

      const result = await repo.updateOptionGroup({
        optionGroupId: group.id,
        data: { name: '새 이름' },
      });
      expect(result.name).toBe('새 이름');
      expect(result.option_items).toHaveLength(1);
    });

    it('softDeleteOptionGroup: deleted_at + is_active:false', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const group = await createOptionGroup(product.id);

      await repo.softDeleteOptionGroup(group.id);
      const after = await prisma.productOptionGroup.findUnique({
        where: { id: group.id },
      });
      expect(after?.deleted_at).not.toBeNull();
      expect(after?.is_active).toBe(false);
    });

    it('listOptionGroupsByProduct: sort_order 오름차순', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const g2 = await prisma.productOptionGroup.create({
        data: { product_id: product.id, name: 'B', sort_order: 1 },
      });
      const g1 = await prisma.productOptionGroup.create({
        data: { product_id: product.id, name: 'A', sort_order: 0 },
      });

      const rows = await repo.listOptionGroupsByProduct(product.id);
      expect(rows.map((r) => r.id)).toEqual([g1.id, g2.id]);
    });

    it('reorderOptionGroups (트랜잭션): sort_order 재할당', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const g1 = await createOptionGroup(product.id, 0);
      const g2 = await createOptionGroup(product.id, 1);

      const rows = await repo.reorderOptionGroups({
        productId: product.id,
        optionGroupIds: [g2.id, g1.id],
      });
      expect(rows.map((r) => r.id)).toEqual([g2.id, g1.id]);

      const sortOrderByGroup = new Map(
        (
          await prisma.productOptionGroup.findMany({
            where: { product_id: product.id },
          })
        ).map((r) => [r.id, r.sort_order]),
      );
      expect(sortOrderByGroup.get(g2.id)).toBe(0);
      expect(sortOrderByGroup.get(g1.id)).toBe(1);
    });

    it('OptionItem CRUD + findOptionItemById(store_id 경유) + softDelete + reorder', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const group = await createOptionGroup(product.id);

      const item = await repo.createOptionItem({
        optionGroupId: group.id,
        data: { title: 'L' },
      });

      const found = await repo.findOptionItemById(item.id);
      expect(found?.option_group.product.store_id).toBe(store.id);

      const updated = await repo.updateOptionItem({
        optionItemId: item.id,
        data: { title: 'XL' },
      });
      expect(updated.title).toBe('XL');

      const item2 = await createOptionItem(group.id, 1);
      const reordered = await repo.reorderOptionItems({
        optionGroupId: group.id,
        optionItemIds: [item2.id, item.id],
      });
      expect(reordered.map((r) => r.id)).toEqual([item2.id, item.id]);

      const sortOrderByItem = new Map(
        (
          await prisma.productOptionItem.findMany({
            where: { option_group_id: group.id },
          })
        ).map((r) => [r.id, r.sort_order]),
      );
      expect(sortOrderByItem.get(item2.id)).toBe(0);
      expect(sortOrderByItem.get(item.id)).toBe(1);

      await repo.softDeleteOptionItem(item.id);
      const after = await prisma.productOptionItem.findUnique({
        where: { id: item.id },
      });
      expect(after?.deleted_at).not.toBeNull();
      expect(after?.is_active).toBe(false);
    });
  });

  // ─── Custom Template / Text Token ──
  describe('Custom template / text token', () => {
    it('upsertProductCustomTemplate: 동일 product_id 재호출 시 같은 row 갱신', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      const first = await repo.upsertProductCustomTemplate({
        productId: product.id,
        baseImageUrl: 'https://i.example/a.png',
        isActive: true,
      });
      const second = await repo.upsertProductCustomTemplate({
        productId: product.id,
        baseImageUrl: 'https://i.example/b.png',
        isActive: false,
      });
      expect(second.id).toBe(first.id);
      expect(second.base_image_url).toBe('https://i.example/b.png');
      expect(second.is_active).toBe(false);
    });

    it('findCustomTemplateById + setCustomTemplateActive', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const tpl = await createTemplate(product.id);

      const found = await repo.findCustomTemplateById(tpl.id);
      expect(found?.product.store_id).toBe(store.id);

      const toggled = await repo.setCustomTemplateActive(tpl.id, false);
      expect(toggled.is_active).toBe(false);
    });

    it('upsertCustomTextToken: tokenId 없으면 create, 있으면 update', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const tpl = await createTemplate(product.id);

      const created = await repo.upsertCustomTextToken({
        templateId: tpl.id,
        tokenKey: 'NAME',
        defaultText: '가',
        maxLength: 30,
        sortOrder: 0,
        isRequired: true,
        posX: 10,
        posY: 20,
        width: 100,
        height: 50,
      });
      expect(created.token_key).toBe('NAME');

      const updated = await repo.upsertCustomTextToken({
        tokenId: created.id,
        templateId: tpl.id,
        tokenKey: 'NAME2',
        defaultText: '나',
        maxLength: 40,
        sortOrder: 0,
        isRequired: false,
        posX: null,
        posY: null,
        width: null,
        height: null,
      });
      expect(updated.id).toBe(created.id);
      expect(updated.token_key).toBe('NAME2');
    });

    it('findCustomTextTokenById (template 경유 store_id 확인용 include)', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const tpl = await createTemplate(product.id);
      const token = await prisma.productCustomTextToken.create({
        data: { template_id: tpl.id, token_key: 'K', default_text: 'V' },
      });

      const found = await repo.findCustomTextTokenById(token.id);
      expect(found?.template.product.store_id).toBe(store.id);
    });

    it('listCustomTextTokens + reorderCustomTextTokens(sort_order 재할당) + softDelete', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const tpl = await createTemplate(product.id);
      const t1 = await prisma.productCustomTextToken.create({
        data: {
          template_id: tpl.id,
          token_key: 'A',
          default_text: 'a',
          sort_order: 0,
        },
      });
      const t2 = await prisma.productCustomTextToken.create({
        data: {
          template_id: tpl.id,
          token_key: 'B',
          default_text: 'b',
          sort_order: 1,
        },
      });

      // list: 기본 sort_order 오름차순
      const listed = await repo.listCustomTextTokens(tpl.id);
      expect(listed.map((r) => r.id)).toEqual([t1.id, t2.id]);

      // reorder: 순서가 뒤집히고 sort_order 값이 0, 1로 재할당됨
      const reordered = await repo.reorderCustomTextTokens({
        templateId: tpl.id,
        tokenIds: [t2.id, t1.id],
      });
      expect(reordered.map((r) => r.id)).toEqual([t2.id, t1.id]);
      const sortOrderByToken = new Map(
        (
          await prisma.productCustomTextToken.findMany({
            where: { template_id: tpl.id },
          })
        ).map((r) => [r.id, r.sort_order]),
      );
      expect(sortOrderByToken.get(t2.id)).toBe(0);
      expect(sortOrderByToken.get(t1.id)).toBe(1);

      // soft-delete
      await repo.softDeleteCustomTextToken(t1.id);
      const after = await prisma.productCustomTextToken.findUnique({
        where: { id: t1.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });
  });

  // ─── Misc ownership ──
  describe('findActiveProduct / findProductOwnership', () => {
    it('findActiveProduct는 is_active:true만 반환', async () => {
      const store = await createStore(prisma);
      const active = await createProduct(prisma, {
        store_id: store.id,
        is_active: true,
      });
      const inactive = await createProduct(prisma, {
        store_id: store.id,
        is_active: false,
      });

      expect(await repo.findActiveProduct(active.id)).not.toBeNull();
      expect(await repo.findActiveProduct(inactive.id)).toBeNull();
    });

    it('findProductOwnership: productId+storeId 조합 확인', async () => {
      const storeA = await createStore(prisma);
      const storeB = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: storeA.id });

      expect(
        await repo.findProductOwnership({
          productId: product.id,
          storeId: storeA.id,
        }),
      ).not.toBeNull();
      expect(
        await repo.findProductOwnership({
          productId: product.id,
          storeId: storeB.id,
        }),
      ).toBeNull();
    });
  });
});
