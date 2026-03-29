import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { SellerContentMutationResolver } from '@/features/seller/resolvers/seller-content-mutation.resolver';
import { SellerContentQueryResolver } from '@/features/seller/resolvers/seller-content-query.resolver';
import { SellerConversationMutationResolver } from '@/features/seller/resolvers/seller-conversation-mutation.resolver';
import { SellerConversationQueryResolver } from '@/features/seller/resolvers/seller-conversation-query.resolver';
import { SellerOrderMutationResolver } from '@/features/seller/resolvers/seller-order-mutation.resolver';
import { SellerOrderQueryResolver } from '@/features/seller/resolvers/seller-order-query.resolver';
import { SellerProductMutationResolver } from '@/features/seller/resolvers/seller-product-mutation.resolver';
import { SellerProductQueryResolver } from '@/features/seller/resolvers/seller-product-query.resolver';
import { SellerStoreMutationResolver } from '@/features/seller/resolvers/seller-store-mutation.resolver';
import { SellerStoreQueryResolver } from '@/features/seller/resolvers/seller-store-query.resolver';
import { SellerContentService } from '@/features/seller/services/seller-content.service';
import { SellerConversationService } from '@/features/seller/services/seller-conversation.service';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';
import { SellerOrderService } from '@/features/seller/services/seller-order.service';
import { SellerProductCrudService } from '@/features/seller/services/seller-product-crud.service';
import { SellerStoreService } from '@/features/seller/services/seller-store.service';

// ---------- 공통 헬퍼 ----------

const user = { accountId: '11' };

describe('SellerResolvers', () => {
  // ── Resolvers ──
  let productQueryResolver: SellerProductQueryResolver;
  let productMutationResolver: SellerProductMutationResolver;
  let contentQueryResolver: SellerContentQueryResolver;
  let contentMutationResolver: SellerContentMutationResolver;
  let storeQueryResolver: SellerStoreQueryResolver;
  let storeMutationResolver: SellerStoreMutationResolver;
  let conversationQueryResolver: SellerConversationQueryResolver;
  let conversationMutationResolver: SellerConversationMutationResolver;
  let orderQueryResolver: SellerOrderQueryResolver;
  let orderMutationResolver: SellerOrderMutationResolver;

  // ── Services (mocked) ──
  let productService: jest.Mocked<SellerProductCrudService>;
  let optionService: jest.Mocked<SellerOptionService>;
  let templateService: jest.Mocked<SellerCustomTemplateService>;
  let contentService: jest.Mocked<SellerContentService>;
  let storeService: jest.Mocked<SellerStoreService>;
  let conversationService: jest.Mocked<SellerConversationService>;
  let orderService: jest.Mocked<SellerOrderService>;

  beforeEach(async () => {
    productService = {
      sellerProducts: jest.fn(),
      sellerProduct: jest.fn(),
      sellerCreateProduct: jest.fn(),
      sellerUpdateProduct: jest.fn(),
      sellerDeleteProduct: jest.fn(),
      sellerSetProductActive: jest.fn(),
      sellerAddProductImage: jest.fn(),
      sellerDeleteProductImage: jest.fn(),
      sellerReorderProductImages: jest.fn(),
      sellerSetProductCategories: jest.fn(),
      sellerSetProductTags: jest.fn(),
    } as unknown as jest.Mocked<SellerProductCrudService>;

    optionService = {
      sellerCreateOptionGroup: jest.fn(),
      sellerUpdateOptionGroup: jest.fn(),
      sellerDeleteOptionGroup: jest.fn(),
      sellerReorderOptionGroups: jest.fn(),
      sellerCreateOptionItem: jest.fn(),
      sellerUpdateOptionItem: jest.fn(),
      sellerDeleteOptionItem: jest.fn(),
      sellerReorderOptionItems: jest.fn(),
    } as unknown as jest.Mocked<SellerOptionService>;

    templateService = {
      sellerUpsertProductCustomTemplate: jest.fn(),
      sellerSetProductCustomTemplateActive: jest.fn(),
      sellerUpsertProductCustomTextToken: jest.fn(),
      sellerDeleteProductCustomTextToken: jest.fn(),
      sellerReorderProductCustomTextTokens: jest.fn(),
    } as unknown as jest.Mocked<SellerCustomTemplateService>;

    contentService = {
      sellerFaqTopics: jest.fn(),
      sellerCreateFaqTopic: jest.fn(),
      sellerUpdateFaqTopic: jest.fn(),
      sellerDeleteFaqTopic: jest.fn(),
      sellerBanners: jest.fn(),
      sellerCreateBanner: jest.fn(),
      sellerUpdateBanner: jest.fn(),
      sellerDeleteBanner: jest.fn(),
      sellerAuditLogs: jest.fn(),
    } as unknown as jest.Mocked<SellerContentService>;

    storeService = {
      sellerMyStore: jest.fn(),
      sellerStoreBusinessHours: jest.fn(),
      sellerStoreSpecialClosures: jest.fn(),
      sellerStoreDailyCapacities: jest.fn(),
      sellerUpdateStoreBasicInfo: jest.fn(),
      sellerUpsertStoreBusinessHour: jest.fn(),
      sellerUpsertStoreSpecialClosure: jest.fn(),
      sellerDeleteStoreSpecialClosure: jest.fn(),
      sellerUpdatePickupPolicy: jest.fn(),
      sellerUpsertStoreDailyCapacity: jest.fn(),
      sellerDeleteStoreDailyCapacity: jest.fn(),
    } as unknown as jest.Mocked<SellerStoreService>;

    conversationService = {
      sellerConversations: jest.fn(),
      sellerConversationMessages: jest.fn(),
      sellerSendConversationMessage: jest.fn(),
    } as unknown as jest.Mocked<SellerConversationService>;

    orderService = {
      sellerOrderList: jest.fn(),
      sellerOrder: jest.fn(),
      sellerUpdateOrderStatus: jest.fn(),
    } as unknown as jest.Mocked<SellerOrderService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        // Resolvers
        SellerProductQueryResolver,
        SellerProductMutationResolver,
        SellerContentQueryResolver,
        SellerContentMutationResolver,
        SellerStoreQueryResolver,
        SellerStoreMutationResolver,
        SellerConversationQueryResolver,
        SellerConversationMutationResolver,
        SellerOrderQueryResolver,
        SellerOrderMutationResolver,
        // Services
        { provide: SellerProductCrudService, useValue: productService },
        { provide: SellerOptionService, useValue: optionService },
        { provide: SellerCustomTemplateService, useValue: templateService },
        { provide: SellerContentService, useValue: contentService },
        { provide: SellerStoreService, useValue: storeService },
        { provide: SellerConversationService, useValue: conversationService },
        { provide: SellerOrderService, useValue: orderService },
      ],
    }).compile();

    productQueryResolver = module.get(SellerProductQueryResolver);
    productMutationResolver = module.get(SellerProductMutationResolver);
    contentQueryResolver = module.get(SellerContentQueryResolver);
    contentMutationResolver = module.get(SellerContentMutationResolver);
    storeQueryResolver = module.get(SellerStoreQueryResolver);
    storeMutationResolver = module.get(SellerStoreMutationResolver);
    conversationQueryResolver = module.get(SellerConversationQueryResolver);
    conversationMutationResolver = module.get(
      SellerConversationMutationResolver,
    );
    orderQueryResolver = module.get(SellerOrderQueryResolver);
    orderMutationResolver = module.get(SellerOrderMutationResolver);
  });

  // ================================================================
  // SellerProductQueryResolver
  // ================================================================
  describe('SellerProductQueryResolver', () => {
    describe('sellerProducts', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { first: 10 };
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        productService.sellerProducts.mockResolvedValue(expected as never);

        const result = await productQueryResolver.sellerProducts(user, input);

        expect(productService.sellerProducts).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });

      it('input 없이 호출할 수 있어야 한다', async () => {
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        productService.sellerProducts.mockResolvedValue(expected as never);

        await productQueryResolver.sellerProducts(user);

        expect(productService.sellerProducts).toHaveBeenCalledWith(
          BigInt(11),
          undefined,
        );
      });
    });

    describe('sellerProduct', () => {
      it('productId를 BigInt로 전달해야 한다', async () => {
        const expected = { id: '123', name: 'test' };
        productService.sellerProduct.mockResolvedValue(expected as never);

        const result = await productQueryResolver.sellerProduct(user, '123');

        expect(productService.sellerProduct).toHaveBeenCalledWith(
          BigInt(11),
          BigInt(123),
        );
        expect(result).toBe(expected);
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        productService.sellerProduct.mockRejectedValue(
          new NotFoundException('상품을 찾을 수 없습니다'),
        );

        await expect(
          productQueryResolver.sellerProduct(user, '999'),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  // ================================================================
  // SellerProductMutationResolver
  // ================================================================
  describe('SellerProductMutationResolver', () => {
    describe('sellerCreateProduct', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { name: '새 상품' };
        const expected = { id: '1', name: '새 상품' };
        productService.sellerCreateProduct.mockResolvedValue(expected as never);

        const result = await productMutationResolver.sellerCreateProduct(
          user,
          input as never,
        );

        expect(productService.sellerCreateProduct).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerUpdateProduct', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { productId: '10', name: '수정 상품' };
        const expected = { id: '10', name: '수정 상품' };
        productService.sellerUpdateProduct.mockResolvedValue(expected as never);

        const result = await productMutationResolver.sellerUpdateProduct(
          user,
          input as never,
        );

        expect(productService.sellerUpdateProduct).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerDeleteProduct', () => {
      it('productId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        productService.sellerDeleteProduct.mockResolvedValue(true);

        const result = await productMutationResolver.sellerDeleteProduct(
          user,
          '55',
        );

        expect(productService.sellerDeleteProduct).toHaveBeenCalledWith(
          BigInt(11),
          BigInt(55),
        );
        expect(result).toBe(true);
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        productService.sellerDeleteProduct.mockRejectedValue(
          new ForbiddenException('권한이 없습니다'),
        );

        await expect(
          productMutationResolver.sellerDeleteProduct(user, '55'),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    describe('sellerSetProductActive', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { productId: '10', active: true };
        const expected = { id: '10', active: true };
        productService.sellerSetProductActive.mockResolvedValue(
          expected as never,
        );

        const result = await productMutationResolver.sellerSetProductActive(
          user,
          input as never,
        );

        expect(productService.sellerSetProductActive).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerAddProductImage', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { productId: '10', url: 'https://img.test/1.jpg' };
        const expected = { id: '1', url: 'https://img.test/1.jpg' };
        productService.sellerAddProductImage.mockResolvedValue(
          expected as never,
        );

        const result = await productMutationResolver.sellerAddProductImage(
          user,
          input as never,
        );

        expect(productService.sellerAddProductImage).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerDeleteProductImage', () => {
      it('imageId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        productService.sellerDeleteProductImage.mockResolvedValue(true);

        const result = await productMutationResolver.sellerDeleteProductImage(
          user,
          '88',
        );

        expect(productService.sellerDeleteProductImage).toHaveBeenCalledWith(
          BigInt(11),
          BigInt(88),
        );
        expect(result).toBe(true);
      });
    });

    describe('sellerReorderProductImages', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { productId: '10', imageIds: ['1', '2', '3'] };
        const expected = [{ id: '1' }, { id: '2' }, { id: '3' }];
        productService.sellerReorderProductImages.mockResolvedValue(
          expected as never,
        );

        const result = await productMutationResolver.sellerReorderProductImages(
          user,
          input as never,
        );

        expect(productService.sellerReorderProductImages).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerSetProductCategories', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { productId: '10', categoryIds: ['1', '2'] };
        const expected = { id: '10' };
        productService.sellerSetProductCategories.mockResolvedValue(
          expected as never,
        );

        const result = await productMutationResolver.sellerSetProductCategories(
          user,
          input as never,
        );

        expect(productService.sellerSetProductCategories).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerSetProductTags', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { productId: '10', tags: ['태그1', '태그2'] };
        const expected = { id: '10' };
        productService.sellerSetProductTags.mockResolvedValue(
          expected as never,
        );

        const result = await productMutationResolver.sellerSetProductTags(
          user,
          input as never,
        );

        expect(productService.sellerSetProductTags).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    // ── OptionService 위임 메서드 ──

    describe('sellerCreateOptionGroup', () => {
      it('accountId를 BigInt로 변환하여 optionService에 전달해야 한다', async () => {
        const input = { productId: '10', name: '사이즈' };
        const expected = { id: '1', name: '사이즈' };
        optionService.sellerCreateOptionGroup.mockResolvedValue(
          expected as never,
        );

        const result = await productMutationResolver.sellerCreateOptionGroup(
          user,
          input as never,
        );

        expect(optionService.sellerCreateOptionGroup).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerUpdateOptionGroup', () => {
      it('accountId를 BigInt로 변환하여 optionService에 전달해야 한다', async () => {
        const input = { optionGroupId: '5', name: '색상' };
        const expected = { id: '5', name: '색상' };
        optionService.sellerUpdateOptionGroup.mockResolvedValue(
          expected as never,
        );

        const result = await productMutationResolver.sellerUpdateOptionGroup(
          user,
          input as never,
        );

        expect(optionService.sellerUpdateOptionGroup).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerDeleteOptionGroup', () => {
      it('optionGroupId를 BigInt로 변환하여 optionService에 전달해야 한다', async () => {
        optionService.sellerDeleteOptionGroup.mockResolvedValue(true);

        const result = await productMutationResolver.sellerDeleteOptionGroup(
          user,
          '33',
        );

        expect(optionService.sellerDeleteOptionGroup).toHaveBeenCalledWith(
          BigInt(11),
          BigInt(33),
        );
        expect(result).toBe(true);
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        optionService.sellerDeleteOptionGroup.mockRejectedValue(
          new NotFoundException('옵션 그룹을 찾을 수 없습니다'),
        );

        await expect(
          productMutationResolver.sellerDeleteOptionGroup(user, '33'),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('sellerReorderOptionGroups', () => {
      it('accountId를 BigInt로 변환하여 optionService에 전달해야 한다', async () => {
        const input = { productId: '10', optionGroupIds: ['1', '2'] };
        const expected = [{ id: '1' }, { id: '2' }];
        optionService.sellerReorderOptionGroups.mockResolvedValue(
          expected as never,
        );

        const result = await productMutationResolver.sellerReorderOptionGroups(
          user,
          input as never,
        );

        expect(optionService.sellerReorderOptionGroups).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerCreateOptionItem', () => {
      it('accountId를 BigInt로 변환하여 optionService에 전달해야 한다', async () => {
        const input = { optionGroupId: '5', name: 'L' };
        const expected = { id: '1', name: 'L' };
        optionService.sellerCreateOptionItem.mockResolvedValue(
          expected as never,
        );

        const result = await productMutationResolver.sellerCreateOptionItem(
          user,
          input as never,
        );

        expect(optionService.sellerCreateOptionItem).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerUpdateOptionItem', () => {
      it('accountId를 BigInt로 변환하여 optionService에 전달해야 한다', async () => {
        const input = { optionItemId: '7', name: 'XL' };
        const expected = { id: '7', name: 'XL' };
        optionService.sellerUpdateOptionItem.mockResolvedValue(
          expected as never,
        );

        const result = await productMutationResolver.sellerUpdateOptionItem(
          user,
          input as never,
        );

        expect(optionService.sellerUpdateOptionItem).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerDeleteOptionItem', () => {
      it('optionItemId를 BigInt로 변환하여 optionService에 전달해야 한다', async () => {
        optionService.sellerDeleteOptionItem.mockResolvedValue(true);

        const result = await productMutationResolver.sellerDeleteOptionItem(
          user,
          '44',
        );

        expect(optionService.sellerDeleteOptionItem).toHaveBeenCalledWith(
          BigInt(11),
          BigInt(44),
        );
        expect(result).toBe(true);
      });
    });

    describe('sellerReorderOptionItems', () => {
      it('accountId를 BigInt로 변환하여 optionService에 전달해야 한다', async () => {
        const input = { optionGroupId: '5', optionItemIds: ['1', '2'] };
        const expected = [{ id: '1' }, { id: '2' }];
        optionService.sellerReorderOptionItems.mockResolvedValue(
          expected as never,
        );

        const result = await productMutationResolver.sellerReorderOptionItems(
          user,
          input as never,
        );

        expect(optionService.sellerReorderOptionItems).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    // ── TemplateService 위임 메서드 ──

    describe('sellerUpsertProductCustomTemplate', () => {
      it('accountId를 BigInt로 변환하여 templateService에 전달해야 한다', async () => {
        const input = { productId: '10', body: '<div>template</div>' };
        const expected = { id: '1', body: '<div>template</div>' };
        templateService.sellerUpsertProductCustomTemplate.mockResolvedValue(
          expected as never,
        );

        const result =
          await productMutationResolver.sellerUpsertProductCustomTemplate(
            user,
            input as never,
          );

        expect(
          templateService.sellerUpsertProductCustomTemplate,
        ).toHaveBeenCalledWith(BigInt(11), input);
        expect(result).toBe(expected);
      });
    });

    describe('sellerSetProductCustomTemplateActive', () => {
      it('accountId를 BigInt로 변환하여 templateService에 전달해야 한다', async () => {
        const input = { productId: '10', active: true };
        const expected = { id: '1', active: true };
        templateService.sellerSetProductCustomTemplateActive.mockResolvedValue(
          expected as never,
        );

        const result =
          await productMutationResolver.sellerSetProductCustomTemplateActive(
            user,
            input as never,
          );

        expect(
          templateService.sellerSetProductCustomTemplateActive,
        ).toHaveBeenCalledWith(BigInt(11), input);
        expect(result).toBe(expected);
      });
    });

    describe('sellerUpsertProductCustomTextToken', () => {
      it('accountId를 BigInt로 변환하여 templateService에 전달해야 한다', async () => {
        const input = { productId: '10', key: 'NAME', value: '테스트' };
        const expected = { id: '1', key: 'NAME', value: '테스트' };
        templateService.sellerUpsertProductCustomTextToken.mockResolvedValue(
          expected as never,
        );

        const result =
          await productMutationResolver.sellerUpsertProductCustomTextToken(
            user,
            input as never,
          );

        expect(
          templateService.sellerUpsertProductCustomTextToken,
        ).toHaveBeenCalledWith(BigInt(11), input);
        expect(result).toBe(expected);
      });
    });

    describe('sellerDeleteProductCustomTextToken', () => {
      it('tokenId를 BigInt로 변환하여 templateService에 전달해야 한다', async () => {
        templateService.sellerDeleteProductCustomTextToken.mockResolvedValue(
          true,
        );

        const result =
          await productMutationResolver.sellerDeleteProductCustomTextToken(
            user,
            '99',
          );

        expect(
          templateService.sellerDeleteProductCustomTextToken,
        ).toHaveBeenCalledWith(BigInt(11), BigInt(99));
        expect(result).toBe(true);
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        templateService.sellerDeleteProductCustomTextToken.mockRejectedValue(
          new NotFoundException('토큰을 찾을 수 없습니다'),
        );

        await expect(
          productMutationResolver.sellerDeleteProductCustomTextToken(
            user,
            '99',
          ),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('sellerReorderProductCustomTextTokens', () => {
      it('accountId를 BigInt로 변환하여 templateService에 전달해야 한다', async () => {
        const input = { productId: '10', tokenIds: ['1', '2'] };
        const expected = [{ id: '1' }, { id: '2' }];
        templateService.sellerReorderProductCustomTextTokens.mockResolvedValue(
          expected as never,
        );

        const result =
          await productMutationResolver.sellerReorderProductCustomTextTokens(
            user,
            input as never,
          );

        expect(
          templateService.sellerReorderProductCustomTextTokens,
        ).toHaveBeenCalledWith(BigInt(11), input);
        expect(result).toBe(expected);
      });
    });
  });

  // ================================================================
  // SellerContentQueryResolver
  // ================================================================
  describe('SellerContentQueryResolver', () => {
    describe('sellerFaqTopics', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const expected = [{ id: '1', title: 'FAQ' }];
        contentService.sellerFaqTopics.mockResolvedValue(expected as never);

        const result = await contentQueryResolver.sellerFaqTopics(user);

        expect(contentService.sellerFaqTopics).toHaveBeenCalledWith(BigInt(11));
        expect(result).toBe(expected);
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        contentService.sellerFaqTopics.mockRejectedValue(
          new ForbiddenException('접근 권한이 없습니다'),
        );

        await expect(
          contentQueryResolver.sellerFaqTopics(user),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    describe('sellerBanners', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { first: 5 };
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        contentService.sellerBanners.mockResolvedValue(expected as never);

        const result = await contentQueryResolver.sellerBanners(user, input);

        expect(contentService.sellerBanners).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });

      it('input 없이 호출할 수 있어야 한다', async () => {
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        contentService.sellerBanners.mockResolvedValue(expected as never);

        await contentQueryResolver.sellerBanners(user);

        expect(contentService.sellerBanners).toHaveBeenCalledWith(
          BigInt(11),
          undefined,
        );
      });
    });

    describe('sellerAuditLogs', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { first: 20 };
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        contentService.sellerAuditLogs.mockResolvedValue(expected as never);

        const result = await contentQueryResolver.sellerAuditLogs(user, input);

        expect(contentService.sellerAuditLogs).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });

      it('input 없이 호출할 수 있어야 한다', async () => {
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        contentService.sellerAuditLogs.mockResolvedValue(expected as never);

        await contentQueryResolver.sellerAuditLogs(user);

        expect(contentService.sellerAuditLogs).toHaveBeenCalledWith(
          BigInt(11),
          undefined,
        );
      });
    });
  });

  // ================================================================
  // SellerContentMutationResolver
  // ================================================================
  describe('SellerContentMutationResolver', () => {
    describe('sellerCreateFaqTopic', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { title: '새 FAQ 주제' };
        const expected = { id: '1', title: '새 FAQ 주제' };
        contentService.sellerCreateFaqTopic.mockResolvedValue(
          expected as never,
        );

        const result = await contentMutationResolver.sellerCreateFaqTopic(
          user,
          input as never,
        );

        expect(contentService.sellerCreateFaqTopic).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerUpdateFaqTopic', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { topicId: '3', title: '수정 FAQ' };
        const expected = { id: '3', title: '수정 FAQ' };
        contentService.sellerUpdateFaqTopic.mockResolvedValue(
          expected as never,
        );

        const result = await contentMutationResolver.sellerUpdateFaqTopic(
          user,
          input as never,
        );

        expect(contentService.sellerUpdateFaqTopic).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerDeleteFaqTopic', () => {
      it('topicId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        contentService.sellerDeleteFaqTopic.mockResolvedValue(true);

        const result = await contentMutationResolver.sellerDeleteFaqTopic(
          user,
          '66',
        );

        expect(contentService.sellerDeleteFaqTopic).toHaveBeenCalledWith(
          BigInt(11),
          BigInt(66),
        );
        expect(result).toBe(true);
      });
    });

    describe('sellerCreateBanner', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { title: '새 배너', imageUrl: 'https://img.test/b.jpg' };
        const expected = { id: '1', title: '새 배너' };
        contentService.sellerCreateBanner.mockResolvedValue(expected as never);

        const result = await contentMutationResolver.sellerCreateBanner(
          user,
          input as never,
        );

        expect(contentService.sellerCreateBanner).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerUpdateBanner', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { bannerId: '5', title: '수정 배너' };
        const expected = { id: '5', title: '수정 배너' };
        contentService.sellerUpdateBanner.mockResolvedValue(expected as never);

        const result = await contentMutationResolver.sellerUpdateBanner(
          user,
          input as never,
        );

        expect(contentService.sellerUpdateBanner).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerDeleteBanner', () => {
      it('bannerId를 BigInt로 전달해야 한다', async () => {
        contentService.sellerDeleteBanner.mockResolvedValue(true);

        const result = await contentMutationResolver.sellerDeleteBanner(
          user,
          '77',
        );

        expect(contentService.sellerDeleteBanner).toHaveBeenCalledWith(
          BigInt(11),
          BigInt(77),
        );
        expect(result).toBe(true);
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        contentService.sellerDeleteBanner.mockRejectedValue(
          new NotFoundException('배너를 찾을 수 없습니다'),
        );

        await expect(
          contentMutationResolver.sellerDeleteBanner(user, '77'),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  // ================================================================
  // SellerStoreQueryResolver
  // ================================================================
  describe('SellerStoreQueryResolver', () => {
    describe('sellerMyStore', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const expected = { id: '1', name: '내 가게' };
        storeService.sellerMyStore.mockResolvedValue(expected as never);

        const result = await storeQueryResolver.sellerMyStore(user);

        expect(storeService.sellerMyStore).toHaveBeenCalledWith(BigInt(11));
        expect(result).toBe(expected);
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        storeService.sellerMyStore.mockRejectedValue(
          new NotFoundException('가게를 찾을 수 없습니다'),
        );

        await expect(storeQueryResolver.sellerMyStore(user)).rejects.toThrow(
          NotFoundException,
        );
      });
    });

    describe('sellerStoreBusinessHours', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const expected = [{ dayOfWeek: 1, openTime: '09:00' }];
        storeService.sellerStoreBusinessHours.mockResolvedValue(
          expected as never,
        );

        const result = await storeQueryResolver.sellerStoreBusinessHours(user);

        expect(storeService.sellerStoreBusinessHours).toHaveBeenCalledWith(
          BigInt(11),
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerStoreSpecialClosures', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { first: 10 };
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        storeService.sellerStoreSpecialClosures.mockResolvedValue(
          expected as never,
        );

        const result = await storeQueryResolver.sellerStoreSpecialClosures(
          user,
          input,
        );

        expect(storeService.sellerStoreSpecialClosures).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });

      it('input 없이 호출할 수 있어야 한다', async () => {
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        storeService.sellerStoreSpecialClosures.mockResolvedValue(
          expected as never,
        );

        await storeQueryResolver.sellerStoreSpecialClosures(user);

        expect(storeService.sellerStoreSpecialClosures).toHaveBeenCalledWith(
          BigInt(11),
          undefined,
        );
      });
    });

    describe('sellerStoreDailyCapacities', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { first: 10 };
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        storeService.sellerStoreDailyCapacities.mockResolvedValue(
          expected as never,
        );

        const result = await storeQueryResolver.sellerStoreDailyCapacities(
          user,
          input,
        );

        expect(storeService.sellerStoreDailyCapacities).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });

      it('input 없이 호출할 수 있어야 한다', async () => {
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        storeService.sellerStoreDailyCapacities.mockResolvedValue(
          expected as never,
        );

        await storeQueryResolver.sellerStoreDailyCapacities(user);

        expect(storeService.sellerStoreDailyCapacities).toHaveBeenCalledWith(
          BigInt(11),
          undefined,
        );
      });
    });
  });

  // ================================================================
  // SellerStoreMutationResolver
  // ================================================================
  describe('SellerStoreMutationResolver', () => {
    describe('sellerUpdateStoreBasicInfo', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { name: '수정된 가게' };
        const expected = { id: '1', name: '수정된 가게' };
        storeService.sellerUpdateStoreBasicInfo.mockResolvedValue(
          expected as never,
        );

        const result = await storeMutationResolver.sellerUpdateStoreBasicInfo(
          user,
          input as never,
        );

        expect(storeService.sellerUpdateStoreBasicInfo).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerUpsertStoreBusinessHour', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { dayOfWeek: 1, openTime: '09:00', closeTime: '18:00' };
        const expected = {
          dayOfWeek: 1,
          openTime: '09:00',
          closeTime: '18:00',
        };
        storeService.sellerUpsertStoreBusinessHour.mockResolvedValue(
          expected as never,
        );

        const result =
          await storeMutationResolver.sellerUpsertStoreBusinessHour(
            user,
            input as never,
          );

        expect(storeService.sellerUpsertStoreBusinessHour).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerUpsertStoreSpecialClosure', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { date: '2026-04-01', reason: '임시 휴업' };
        const expected = { id: '1', date: '2026-04-01', reason: '임시 휴업' };
        storeService.sellerUpsertStoreSpecialClosure.mockResolvedValue(
          expected as never,
        );

        const result =
          await storeMutationResolver.sellerUpsertStoreSpecialClosure(
            user,
            input as never,
          );

        expect(
          storeService.sellerUpsertStoreSpecialClosure,
        ).toHaveBeenCalledWith(BigInt(11), input);
        expect(result).toBe(expected);
      });
    });

    describe('sellerDeleteStoreSpecialClosure', () => {
      it('closureId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        storeService.sellerDeleteStoreSpecialClosure.mockResolvedValue(true);

        const result =
          await storeMutationResolver.sellerDeleteStoreSpecialClosure(
            user,
            '22',
          );

        expect(
          storeService.sellerDeleteStoreSpecialClosure,
        ).toHaveBeenCalledWith(BigInt(11), BigInt(22));
        expect(result).toBe(true);
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        storeService.sellerDeleteStoreSpecialClosure.mockRejectedValue(
          new NotFoundException('특별 휴일을 찾을 수 없습니다'),
        );

        await expect(
          storeMutationResolver.sellerDeleteStoreSpecialClosure(user, '22'),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('sellerUpdatePickupPolicy', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { minPickupMinutes: 30 };
        const expected = { id: '1', minPickupMinutes: 30 };
        storeService.sellerUpdatePickupPolicy.mockResolvedValue(
          expected as never,
        );

        const result = await storeMutationResolver.sellerUpdatePickupPolicy(
          user,
          input as never,
        );

        expect(storeService.sellerUpdatePickupPolicy).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });
    });

    describe('sellerUpsertStoreDailyCapacity', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { date: '2026-04-01', capacity: 50 };
        const expected = { id: '1', date: '2026-04-01', capacity: 50 };
        storeService.sellerUpsertStoreDailyCapacity.mockResolvedValue(
          expected as never,
        );

        const result =
          await storeMutationResolver.sellerUpsertStoreDailyCapacity(
            user,
            input as never,
          );

        expect(
          storeService.sellerUpsertStoreDailyCapacity,
        ).toHaveBeenCalledWith(BigInt(11), input);
        expect(result).toBe(expected);
      });
    });

    describe('sellerDeleteStoreDailyCapacity', () => {
      it('capacityId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        storeService.sellerDeleteStoreDailyCapacity.mockResolvedValue(true);

        const result =
          await storeMutationResolver.sellerDeleteStoreDailyCapacity(
            user,
            '15',
          );

        expect(
          storeService.sellerDeleteStoreDailyCapacity,
        ).toHaveBeenCalledWith(BigInt(11), BigInt(15));
        expect(result).toBe(true);
      });
    });
  });

  // ================================================================
  // SellerConversationQueryResolver
  // ================================================================
  describe('SellerConversationQueryResolver', () => {
    describe('sellerConversations', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { first: 10 };
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        conversationService.sellerConversations.mockResolvedValue(
          expected as never,
        );

        const result = await conversationQueryResolver.sellerConversations(
          user,
          input,
        );

        expect(conversationService.sellerConversations).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });

      it('input 없이 호출할 수 있어야 한다', async () => {
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        conversationService.sellerConversations.mockResolvedValue(
          expected as never,
        );

        await conversationQueryResolver.sellerConversations(user);

        expect(conversationService.sellerConversations).toHaveBeenCalledWith(
          BigInt(11),
          undefined,
        );
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        conversationService.sellerConversations.mockRejectedValue(
          new ForbiddenException('접근 권한이 없습니다'),
        );

        await expect(
          conversationQueryResolver.sellerConversations(user),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    describe('sellerConversationMessages', () => {
      it('conversationId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { first: 20 };
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        conversationService.sellerConversationMessages.mockResolvedValue(
          expected as never,
        );

        const result =
          await conversationQueryResolver.sellerConversationMessages(
            user,
            '42',
            input,
          );

        expect(
          conversationService.sellerConversationMessages,
        ).toHaveBeenCalledWith(BigInt(11), BigInt(42), input);
        expect(result).toBe(expected);
      });

      it('input 없이 호출할 수 있어야 한다', async () => {
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        conversationService.sellerConversationMessages.mockResolvedValue(
          expected as never,
        );

        await conversationQueryResolver.sellerConversationMessages(user, '42');

        expect(
          conversationService.sellerConversationMessages,
        ).toHaveBeenCalledWith(BigInt(11), BigInt(42), undefined);
      });
    });
  });

  // ================================================================
  // SellerConversationMutationResolver
  // ================================================================
  describe('SellerConversationMutationResolver', () => {
    describe('sellerSendConversationMessage', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { conversationId: '42', body: '안녕하세요' };
        const expected = { id: '1', body: '안녕하세요' };
        conversationService.sellerSendConversationMessage.mockResolvedValue(
          expected as never,
        );

        const result =
          await conversationMutationResolver.sellerSendConversationMessage(
            user,
            input as never,
          );

        expect(
          conversationService.sellerSendConversationMessage,
        ).toHaveBeenCalledWith(BigInt(11), input);
        expect(result).toBe(expected);
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        conversationService.sellerSendConversationMessage.mockRejectedValue(
          new NotFoundException('대화를 찾을 수 없습니다'),
        );

        await expect(
          conversationMutationResolver.sellerSendConversationMessage(user, {
            conversationId: '42',
            body: '안녕하세요',
          } as never),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  // ================================================================
  // SellerOrderQueryResolver
  // ================================================================
  describe('SellerOrderQueryResolver', () => {
    describe('sellerOrderList', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { first: 10 };
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        orderService.sellerOrderList.mockResolvedValue(expected as never);

        const result = await orderQueryResolver.sellerOrderList(user, input);

        expect(orderService.sellerOrderList).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });

      it('input 없이 호출할 수 있어야 한다', async () => {
        const expected = { edges: [], pageInfo: { hasNextPage: false } };
        orderService.sellerOrderList.mockResolvedValue(expected as never);

        await orderQueryResolver.sellerOrderList(user);

        expect(orderService.sellerOrderList).toHaveBeenCalledWith(
          BigInt(11),
          undefined,
        );
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        orderService.sellerOrderList.mockRejectedValue(
          new ForbiddenException('주문 접근 권한이 없습니다'),
        );

        await expect(orderQueryResolver.sellerOrderList(user)).rejects.toThrow(
          ForbiddenException,
        );
      });
    });

    describe('sellerOrder', () => {
      it('orderId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const expected = { id: '100', status: 'PENDING' };
        orderService.sellerOrder.mockResolvedValue(expected as never);

        const result = await orderQueryResolver.sellerOrder(user, '100');

        expect(orderService.sellerOrder).toHaveBeenCalledWith(
          BigInt(11),
          BigInt(100),
        );
        expect(result).toBe(expected);
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        orderService.sellerOrder.mockRejectedValue(
          new NotFoundException('주문을 찾을 수 없습니다'),
        );

        await expect(
          orderQueryResolver.sellerOrder(user, '999'),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  // ================================================================
  // SellerOrderMutationResolver
  // ================================================================
  describe('SellerOrderMutationResolver', () => {
    describe('sellerUpdateOrderStatus', () => {
      it('accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
        const input = { orderId: '100', status: 'CONFIRMED' };
        const expected = { id: '100', status: 'CONFIRMED' };
        orderService.sellerUpdateOrderStatus.mockResolvedValue(
          expected as never,
        );

        const result = await orderMutationResolver.sellerUpdateOrderStatus(
          user,
          input as never,
        );

        expect(orderService.sellerUpdateOrderStatus).toHaveBeenCalledWith(
          BigInt(11),
          input,
        );
        expect(result).toBe(expected);
      });

      it('서비스 예외가 그대로 전파되어야 한다', async () => {
        orderService.sellerUpdateOrderStatus.mockRejectedValue(
          new ForbiddenException('주문 상태 변경 권한이 없습니다'),
        );

        await expect(
          orderMutationResolver.sellerUpdateOrderStatus(user, {
            orderId: '100',
            status: 'CONFIRMED',
          } as never),
        ).rejects.toThrow(ForbiddenException);
      });
    });
  });
});
