import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerProductMutationResolver } from '@/features/seller/resolvers/seller-product-mutation.resolver';
import { SellerProductQueryResolver } from '@/features/seller/resolvers/seller-product-query.resolver';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';
import { SellerProductCrudService } from '@/features/seller/services/seller-product-crud.service';
import type {
  SellerAddProductImageInput,
  SellerCreateOptionGroupInput,
  SellerCreateOptionItemInput,
  SellerCreateProductInput,
  SellerReorderOptionGroupsInput,
  SellerReorderOptionItemsInput,
  SellerReorderProductCustomTextTokensInput,
  SellerReorderProductImagesInput,
  SellerSetProductActiveInput,
  SellerSetProductCategoriesInput,
  SellerSetProductCustomTemplateActiveInput,
  SellerSetProductTagsInput,
  SellerUpdateOptionGroupInput,
  SellerUpdateOptionItemInput,
  SellerUpdateProductInput,
  SellerUpsertProductCustomTemplateInput,
  SellerUpsertProductCustomTextTokenInput,
} from '@/features/seller/types/seller-input.type';
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

    const createInput: SellerCreateProductInput = {
      name: '신상',
      regularPrice: 10000,
      initialImageUrl: 'https://i.example/a.png',
    };
    const created = await mutationResolver.sellerCreateProduct(
      { accountId: account.id.toString() },
      createInput,
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

    const badInput: SellerCreateOptionGroupInput = {
      productId: product.id.toString(),
      name: 'X',
      minSelect: 3,
      maxSelect: 1,
    };
    await expect(
      mutationResolver.sellerCreateOptionGroup(
        { accountId: account.id.toString() },
        badInput,
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
      const createInput: SellerCreateProductInput = {
        name: '원본',
        regularPrice: 10000,
        initialImageUrl: 'https://i.example/init.png',
      };
      const created = await mutationResolver.sellerCreateProduct(
        auth,
        createInput,
      );
      return { account, store, auth, productId: created.id };
    }

    it('product CRUD + image + category + tag mutation 배선', async () => {
      const { auth, productId } = await setupProductForMutationWiring();

      // update / setActive
      const updateInput: SellerUpdateProductInput = {
        productId,
        name: '수정됨',
      };
      const updated = await mutationResolver.sellerUpdateProduct(
        auth,
        updateInput,
      );
      expect(updated.name).toBe('수정됨');

      const setActiveInput: SellerSetProductActiveInput = {
        productId,
        isActive: false,
      };
      const toggled = await mutationResolver.sellerSetProductActive(
        auth,
        setActiveInput,
      );
      expect(toggled.isActive).toBe(false);

      // image add / reorder / delete
      const addImageInput: SellerAddProductImageInput = {
        productId,
        imageUrl: 'https://i.example/b.png',
      };
      const addedImage = await mutationResolver.sellerAddProductImage(
        auth,
        addImageInput,
      );
      const initialImage = await prisma.productImage.findFirstOrThrow({
        where: {
          product_id: BigInt(productId),
          id: { not: BigInt(addedImage.id) },
        },
      });
      const reorderImagesInput: SellerReorderProductImagesInput = {
        productId,
        imageIds: [addedImage.id, initialImage.id.toString()],
      };
      const reordered = await mutationResolver.sellerReorderProductImages(
        auth,
        reorderImagesInput,
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
      const setCategoriesInput: SellerSetProductCategoriesInput = {
        productId,
        categoryIds: [category.id.toString()],
      };
      const withCategory = await mutationResolver.sellerSetProductCategories(
        auth,
        setCategoriesInput,
      );
      expect(withCategory.categories.map((c) => c.name)).toContain('생일');

      const tag = await prisma.tag.create({ data: { name: '레터링' } });
      const setTagsInput: SellerSetProductTagsInput = {
        productId,
        tagIds: [tag.id.toString()],
      };
      const withTag = await mutationResolver.sellerSetProductTags(
        auth,
        setTagsInput,
      );
      expect(withTag.tags.map((t) => t.name)).toContain('레터링');

      // 본인 product delete
      expect(await mutationResolver.sellerDeleteProduct(auth, productId)).toBe(
        true,
      );
    });

    it('option group lifecycle(create/update/reorder/delete) 배선', async () => {
      const { auth, productId } = await setupProductForMutationWiring();

      const createGroup1: SellerCreateOptionGroupInput = {
        productId,
        name: '사이즈',
        minSelect: 1,
        maxSelect: 1,
      };
      const group1 = await mutationResolver.sellerCreateOptionGroup(
        auth,
        createGroup1,
      );
      const createGroup2: SellerCreateOptionGroupInput = {
        productId,
        name: '토핑',
        minSelect: 0,
        maxSelect: 3,
      };
      const group2 = await mutationResolver.sellerCreateOptionGroup(
        auth,
        createGroup2,
      );

      const updateGroupInput: SellerUpdateOptionGroupInput = {
        optionGroupId: group1.id,
        name: '사이즈(수정)',
      };
      const groupUpdated = await mutationResolver.sellerUpdateOptionGroup(
        auth,
        updateGroupInput,
      );
      expect(groupUpdated.name).toBe('사이즈(수정)');

      const reorderGroupsInput: SellerReorderOptionGroupsInput = {
        productId,
        optionGroupIds: [group2.id, group1.id],
      };
      const reorderedGroups = await mutationResolver.sellerReorderOptionGroups(
        auth,
        reorderGroupsInput,
      );
      expect(reorderedGroups.map((g) => g.id)).toEqual([group2.id, group1.id]);

      expect(
        await mutationResolver.sellerDeleteOptionGroup(auth, group2.id),
      ).toBe(true);
    });

    it('option item lifecycle(create/update/reorder/delete) 배선', async () => {
      const { auth, productId } = await setupProductForMutationWiring();
      const createGroupInput: SellerCreateOptionGroupInput = {
        productId,
        name: '사이즈',
        minSelect: 0,
        maxSelect: 3,
      };
      const group = await mutationResolver.sellerCreateOptionGroup(
        auth,
        createGroupInput,
      );

      const createItem1: SellerCreateOptionItemInput = {
        optionGroupId: group.id,
        title: 'S',
        priceDelta: 0,
      };
      const item1 = await mutationResolver.sellerCreateOptionItem(
        auth,
        createItem1,
      );
      const createItem2: SellerCreateOptionItemInput = {
        optionGroupId: group.id,
        title: 'M',
        priceDelta: 1000,
      };
      const item2 = await mutationResolver.sellerCreateOptionItem(
        auth,
        createItem2,
      );

      const updateItemInput: SellerUpdateOptionItemInput = {
        optionItemId: item1.id,
        title: 'Small',
      };
      const itemUpdated = await mutationResolver.sellerUpdateOptionItem(
        auth,
        updateItemInput,
      );
      expect(itemUpdated.title).toBe('Small');

      const reorderItemsInput: SellerReorderOptionItemsInput = {
        optionGroupId: group.id,
        optionItemIds: [item2.id, item1.id],
      };
      const reorderedItems = await mutationResolver.sellerReorderOptionItems(
        auth,
        reorderItemsInput,
      );
      expect(reorderedItems.map((i) => i.id)).toEqual([item2.id, item1.id]);

      expect(
        await mutationResolver.sellerDeleteOptionItem(auth, item2.id),
      ).toBe(true);
    });

    it('custom template + text token lifecycle 배선', async () => {
      const { auth, productId } = await setupProductForMutationWiring();

      const upsertTemplateInput: SellerUpsertProductCustomTemplateInput = {
        productId,
        baseImageUrl: 'https://i.example/tpl.png',
        isActive: true,
      };
      const template = await mutationResolver.sellerUpsertProductCustomTemplate(
        auth,
        upsertTemplateInput,
      );
      const setTemplateActiveInput: SellerSetProductCustomTemplateActiveInput =
        {
          templateId: template.id,
          isActive: false,
        };
      const templateActive =
        await mutationResolver.sellerSetProductCustomTemplateActive(
          auth,
          setTemplateActiveInput,
        );
      expect(templateActive.isActive).toBe(false);

      const upsertToken1: SellerUpsertProductCustomTextTokenInput = {
        templateId: template.id,
        tokenKey: 'name',
        defaultText: '기본',
      };
      const token1 = await mutationResolver.sellerUpsertProductCustomTextToken(
        auth,
        upsertToken1,
      );
      const upsertToken2: SellerUpsertProductCustomTextTokenInput = {
        templateId: template.id,
        tokenKey: 'age',
        defaultText: '10',
      };
      const token2 = await mutationResolver.sellerUpsertProductCustomTextToken(
        auth,
        upsertToken2,
      );

      const reorderTokensInput: SellerReorderProductCustomTextTokensInput = {
        templateId: template.id,
        tokenIds: [token2.id, token1.id],
      };
      const reorderedTokens =
        await mutationResolver.sellerReorderProductCustomTextTokens(
          auth,
          reorderTokensInput,
        );
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
