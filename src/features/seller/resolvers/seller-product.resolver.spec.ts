import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerProductMutationResolver } from '@/features/seller/resolvers/seller-product-mutation.resolver';
import { SellerProductQueryResolver } from '@/features/seller/resolvers/seller-product-query.resolver';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';
import { SellerProductCrudService } from '@/features/seller/services/seller-product-crud.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Seller Product Resolvers (real DB)', () => {
  let queryResolver: SellerProductQueryResolver;
  let mutationResolver: SellerProductMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerProductQueryResolver,
        SellerProductMutationResolver,
        SellerProductCrudService,
        SellerOptionService,
        SellerCustomTemplateService,
        SellerRepository,
        ProductRepository,
      ],
    });
    queryResolver = module.get(SellerProductQueryResolver);
    mutationResolver = module.get(SellerProductMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Mutation.sellerCreateProduct + Query.sellerProducts: DB 왕복 반영', async () => {
    const { account } = await setupSellerWithStore(prisma);

    const created = await mutationResolver.sellerCreateProduct(
      { accountId: account.id.toString() },
      {
        name: '신상',
        regularPrice: 10000,
        initialImageUrl: 'https://i.example/a.png',
      } as never,
    );
    expect(created.name).toBe('신상');

    const list = await queryResolver.sellerProducts({
      accountId: account.id.toString(),
    });
    expect(list.items).toHaveLength(1);
  });

  it('Mutation.sellerDeleteProduct: 타 store 상품 접근은 NotFoundException 전파', async () => {
    const me = await setupSellerWithStore(prisma);
    const other = await setupSellerWithStore(prisma);
    const othersProduct = await createProduct(prisma, {
      store_id: other.store.id,
    });

    await expect(
      mutationResolver.sellerDeleteProduct(
        { accountId: me.account.id.toString() },
        othersProduct.id.toString(),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('Mutation.sellerCreateOptionGroup: option 서비스 예외(BadRequest) 전파', async () => {
    const { account, store } = await setupSellerWithStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });

    await expect(
      mutationResolver.sellerCreateOptionGroup(
        { accountId: account.id.toString() },
        {
          productId: product.id.toString(),
          name: 'X',
          minSelect: 3,
          maxSelect: 1,
        } as never,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  /**
   * 모든 seller-product-mutation resolver 메서드를 도메인 단위로 묶어 배선만 검증하는 통합 테스트.
   * 상세 분기/예외는 service.spec에서 담당하며, 여기는 resolver → service → repository 어댑터
   * 계층이 정상 배선되었는지만 확인한다.
   *
   * truncateAll이 beforeEach에서 동작하므로, 각 it은 자체 setup(seller + product)으로 시작한다.
   */
  describe('전체 Mutation 메서드 배선 커버리지', () => {
    /**
     * 본 describe의 공통 setup. account/store + 1개 product를 만들고 auth/productId/auth+resolver 호출에
     * 필요한 최소 입력을 반환한다.
     */
    async function setupProductForMutationWiring() {
      const { account, store } = await setupSellerWithStore(prisma);
      const auth = { accountId: account.id.toString() };
      const created = await mutationResolver.sellerCreateProduct(auth, {
        name: '원본',
        regularPrice: 10000,
        initialImageUrl: 'https://i.example/init.png',
      } as never);
      return { account, store, auth, productId: created.id };
    }

    it('product CRUD + image + category + tag mutation 배선', async () => {
      const { auth, productId } = await setupProductForMutationWiring();

      // update / setActive
      const updated = await mutationResolver.sellerUpdateProduct(auth, {
        productId,
        name: '수정됨',
      } as never);
      expect(updated.name).toBe('수정됨');

      const toggled = await mutationResolver.sellerSetProductActive(auth, {
        productId,
        isActive: false,
      } as never);
      expect(toggled.isActive).toBe(false);

      // image add / reorder / delete
      const addedImage = await mutationResolver.sellerAddProductImage(auth, {
        productId,
        imageUrl: 'https://i.example/b.png',
      } as never);
      const initialImage = await prisma.productImage.findFirstOrThrow({
        where: {
          product_id: BigInt(productId),
          id: { not: BigInt(addedImage.id) },
        },
      });
      const reordered = await mutationResolver.sellerReorderProductImages(
        auth,
        {
          productId,
          imageIds: [addedImage.id, initialImage.id.toString()],
        } as never,
      );
      expect(reordered.map((r) => r.id)).toEqual([
        addedImage.id,
        initialImage.id.toString(),
      ]);
      expect(
        await mutationResolver.sellerDeleteProductImage(auth, addedImage.id),
      ).toBe(true);

      // category / tag
      const category = await prisma.category.create({
        data: { name: '생일', category_type: 'EVENT' },
      });
      const withCategory = await mutationResolver.sellerSetProductCategories(
        auth,
        {
          productId,
          categoryIds: [category.id.toString()],
        } as never,
      );
      expect(withCategory.categories.map((c) => c.name)).toContain('생일');

      const tag = await prisma.tag.create({ data: { name: '레터링' } });
      const withTag = await mutationResolver.sellerSetProductTags(auth, {
        productId,
        tagIds: [tag.id.toString()],
      } as never);
      expect(withTag.tags.map((t) => t.name)).toContain('레터링');

      // 본인 product delete
      expect(await mutationResolver.sellerDeleteProduct(auth, productId)).toBe(
        true,
      );
    });

    it('option group lifecycle(create/update/reorder/delete) 배선', async () => {
      const { auth, productId } = await setupProductForMutationWiring();

      const group1 = await mutationResolver.sellerCreateOptionGroup(auth, {
        productId,
        name: '사이즈',
        minSelect: 1,
        maxSelect: 1,
      } as never);
      const group2 = await mutationResolver.sellerCreateOptionGroup(auth, {
        productId,
        name: '토핑',
        minSelect: 0,
        maxSelect: 3,
      } as never);

      const groupUpdated = await mutationResolver.sellerUpdateOptionGroup(
        auth,
        { optionGroupId: group1.id, name: '사이즈(수정)' } as never,
      );
      expect(groupUpdated.name).toBe('사이즈(수정)');

      const reorderedGroups = await mutationResolver.sellerReorderOptionGroups(
        auth,
        {
          productId,
          optionGroupIds: [group2.id, group1.id],
        } as never,
      );
      expect(reorderedGroups.map((g) => g.id)).toEqual([group2.id, group1.id]);

      expect(
        await mutationResolver.sellerDeleteOptionGroup(auth, group2.id),
      ).toBe(true);
    });

    it('option item lifecycle(create/update/reorder/delete) 배선', async () => {
      const { auth, productId } = await setupProductForMutationWiring();
      const group = await mutationResolver.sellerCreateOptionGroup(auth, {
        productId,
        name: '사이즈',
        minSelect: 0,
        maxSelect: 3,
      } as never);

      const item1 = await mutationResolver.sellerCreateOptionItem(auth, {
        optionGroupId: group.id,
        title: 'S',
        priceDelta: 0,
      } as never);
      const item2 = await mutationResolver.sellerCreateOptionItem(auth, {
        optionGroupId: group.id,
        title: 'M',
        priceDelta: 1000,
      } as never);

      const itemUpdated = await mutationResolver.sellerUpdateOptionItem(auth, {
        optionItemId: item1.id,
        title: 'Small',
      } as never);
      expect(itemUpdated.title).toBe('Small');

      const reorderedItems = await mutationResolver.sellerReorderOptionItems(
        auth,
        {
          optionGroupId: group.id,
          optionItemIds: [item2.id, item1.id],
        } as never,
      );
      expect(reorderedItems.map((i) => i.id)).toEqual([item2.id, item1.id]);

      expect(
        await mutationResolver.sellerDeleteOptionItem(auth, item2.id),
      ).toBe(true);
    });

    it('custom template + text token lifecycle 배선', async () => {
      const { auth, productId } = await setupProductForMutationWiring();

      const template = await mutationResolver.sellerUpsertProductCustomTemplate(
        auth,
        {
          productId,
          baseImageUrl: 'https://i.example/tpl.png',
          isActive: true,
        } as never,
      );
      const templateActive =
        await mutationResolver.sellerSetProductCustomTemplateActive(auth, {
          templateId: template.id,
          isActive: false,
        } as never);
      expect(templateActive.isActive).toBe(false);

      const token1 = await mutationResolver.sellerUpsertProductCustomTextToken(
        auth,
        {
          templateId: template.id,
          tokenKey: 'name',
          defaultText: '기본',
        } as never,
      );
      const token2 = await mutationResolver.sellerUpsertProductCustomTextToken(
        auth,
        {
          templateId: template.id,
          tokenKey: 'age',
          defaultText: '10',
        } as never,
      );

      const reorderedTokens =
        await mutationResolver.sellerReorderProductCustomTextTokens(auth, {
          templateId: template.id,
          tokenIds: [token2.id, token1.id],
        } as never);
      expect(reorderedTokens.map((t) => t.id)).toEqual([token2.id, token1.id]);

      expect(
        await mutationResolver.sellerDeleteProductCustomTextToken(
          auth,
          token1.id,
        ),
      ).toBe(true);
    });
  });
});
