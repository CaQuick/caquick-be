import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { SellerAddProductImageInput } from '@/features/seller/dto/inputs/seller-add-product-image.input';
import { SellerCreateOptionGroupInput } from '@/features/seller/dto/inputs/seller-create-option-group.input';
import { SellerCreateOptionItemInput } from '@/features/seller/dto/inputs/seller-create-option-item.input';
import { SellerCreateProductInput } from '@/features/seller/dto/inputs/seller-create-product.input';
import { SellerReorderOptionGroupsInput } from '@/features/seller/dto/inputs/seller-reorder-option-groups.input';
import { SellerReorderOptionItemsInput } from '@/features/seller/dto/inputs/seller-reorder-option-items.input';
import { SellerReorderProductCustomTextTokensInput } from '@/features/seller/dto/inputs/seller-reorder-product-custom-text-tokens.input';
import { SellerReorderProductImagesInput } from '@/features/seller/dto/inputs/seller-reorder-product-images.input';
import { SellerSetProductActiveInput } from '@/features/seller/dto/inputs/seller-set-product-active.input';
import { SellerSetProductCategoriesInput } from '@/features/seller/dto/inputs/seller-set-product-categories.input';
import { SellerSetProductCustomTemplateActiveInput } from '@/features/seller/dto/inputs/seller-set-product-custom-template-active.input';
import { SellerSetProductTagsInput } from '@/features/seller/dto/inputs/seller-set-product-tags.input';
import { SellerUpdateOptionGroupInput } from '@/features/seller/dto/inputs/seller-update-option-group.input';
import { SellerUpdateOptionItemInput } from '@/features/seller/dto/inputs/seller-update-option-item.input';
import { SellerUpdateProductInput } from '@/features/seller/dto/inputs/seller-update-product.input';
import { SellerUpsertProductCustomTemplateInput } from '@/features/seller/dto/inputs/seller-upsert-product-custom-template.input';
import { SellerUpsertProductCustomTextTokenInput } from '@/features/seller/dto/inputs/seller-upsert-product-custom-text-token.input';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';
import { SellerProductCrudService } from '@/features/seller/services/seller-product-crud.service';
import type {
  SellerCustomTemplateOutput,
  SellerCustomTextTokenOutput,
  SellerOptionGroupOutput,
  SellerOptionItemOutput,
  SellerProductImageOutput,
  SellerProductOutput,
} from '@/features/seller/types/seller-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class SellerProductMutationResolver {
  constructor(
    private readonly productService: SellerProductCrudService,
    private readonly optionService: SellerOptionService,
    private readonly templateService: SellerCustomTemplateService,
  ) {}

  @Mutation('sellerCreateProduct')
  sellerCreateProduct(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateProductInput,
  ): Promise<SellerProductOutput> {
    const accountId = parseAccountId(user);
    return this.productService.sellerCreateProduct(accountId, input);
  }

  @Mutation('sellerUpdateProduct')
  sellerUpdateProduct(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateProductInput,
  ): Promise<SellerProductOutput> {
    const accountId = parseAccountId(user);
    return this.productService.sellerUpdateProduct(accountId, input);
  }

  @Mutation('sellerDeleteProduct')
  sellerDeleteProduct(
    @CurrentUser() user: JwtUser,
    @Args('productId') productId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.productService.sellerDeleteProduct(
      accountId,
      parseId(productId),
    );
  }

  @Mutation('sellerSetProductActive')
  sellerSetProductActive(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerSetProductActiveInput,
  ): Promise<SellerProductOutput> {
    const accountId = parseAccountId(user);
    return this.productService.sellerSetProductActive(accountId, input);
  }

  @Mutation('sellerAddProductImage')
  sellerAddProductImage(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerAddProductImageInput,
  ): Promise<SellerProductImageOutput> {
    const accountId = parseAccountId(user);
    return this.productService.sellerAddProductImage(accountId, input);
  }

  @Mutation('sellerDeleteProductImage')
  sellerDeleteProductImage(
    @CurrentUser() user: JwtUser,
    @Args('imageId') imageId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.productService.sellerDeleteProductImage(
      accountId,
      parseId(imageId),
    );
  }

  @Mutation('sellerReorderProductImages')
  sellerReorderProductImages(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerReorderProductImagesInput,
  ): Promise<SellerProductImageOutput[]> {
    const accountId = parseAccountId(user);
    return this.productService.sellerReorderProductImages(accountId, input);
  }

  @Mutation('sellerSetProductCategories')
  sellerSetProductCategories(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerSetProductCategoriesInput,
  ): Promise<SellerProductOutput> {
    const accountId = parseAccountId(user);
    return this.productService.sellerSetProductCategories(accountId, input);
  }

  @Mutation('sellerSetProductTags')
  sellerSetProductTags(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerSetProductTagsInput,
  ): Promise<SellerProductOutput> {
    const accountId = parseAccountId(user);
    return this.productService.sellerSetProductTags(accountId, input);
  }

  @Mutation('sellerCreateOptionGroup')
  sellerCreateOptionGroup(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateOptionGroupInput,
  ): Promise<SellerOptionGroupOutput> {
    const accountId = parseAccountId(user);
    return this.optionService.sellerCreateOptionGroup(accountId, input);
  }

  @Mutation('sellerUpdateOptionGroup')
  sellerUpdateOptionGroup(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateOptionGroupInput,
  ): Promise<SellerOptionGroupOutput> {
    const accountId = parseAccountId(user);
    return this.optionService.sellerUpdateOptionGroup(accountId, input);
  }

  @Mutation('sellerDeleteOptionGroup')
  sellerDeleteOptionGroup(
    @CurrentUser() user: JwtUser,
    @Args('optionGroupId') optionGroupId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.optionService.sellerDeleteOptionGroup(
      accountId,
      parseId(optionGroupId),
    );
  }

  @Mutation('sellerReorderOptionGroups')
  sellerReorderOptionGroups(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerReorderOptionGroupsInput,
  ): Promise<SellerOptionGroupOutput[]> {
    const accountId = parseAccountId(user);
    return this.optionService.sellerReorderOptionGroups(accountId, input);
  }

  @Mutation('sellerCreateOptionItem')
  sellerCreateOptionItem(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateOptionItemInput,
  ): Promise<SellerOptionItemOutput> {
    const accountId = parseAccountId(user);
    return this.optionService.sellerCreateOptionItem(accountId, input);
  }

  @Mutation('sellerUpdateOptionItem')
  sellerUpdateOptionItem(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateOptionItemInput,
  ): Promise<SellerOptionItemOutput> {
    const accountId = parseAccountId(user);
    return this.optionService.sellerUpdateOptionItem(accountId, input);
  }

  @Mutation('sellerDeleteOptionItem')
  sellerDeleteOptionItem(
    @CurrentUser() user: JwtUser,
    @Args('optionItemId') optionItemId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.optionService.sellerDeleteOptionItem(
      accountId,
      parseId(optionItemId),
    );
  }

  @Mutation('sellerReorderOptionItems')
  sellerReorderOptionItems(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerReorderOptionItemsInput,
  ): Promise<SellerOptionItemOutput[]> {
    const accountId = parseAccountId(user);
    return this.optionService.sellerReorderOptionItems(accountId, input);
  }

  @Mutation('sellerUpsertProductCustomTemplate')
  sellerUpsertProductCustomTemplate(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertProductCustomTemplateInput,
  ): Promise<SellerCustomTemplateOutput> {
    const accountId = parseAccountId(user);
    return this.templateService.sellerUpsertProductCustomTemplate(
      accountId,
      input,
    );
  }

  @Mutation('sellerSetProductCustomTemplateActive')
  sellerSetProductCustomTemplateActive(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerSetProductCustomTemplateActiveInput,
  ): Promise<SellerCustomTemplateOutput> {
    const accountId = parseAccountId(user);
    return this.templateService.sellerSetProductCustomTemplateActive(
      accountId,
      input,
    );
  }

  @Mutation('sellerUpsertProductCustomTextToken')
  sellerUpsertProductCustomTextToken(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertProductCustomTextTokenInput,
  ): Promise<SellerCustomTextTokenOutput> {
    const accountId = parseAccountId(user);
    return this.templateService.sellerUpsertProductCustomTextToken(
      accountId,
      input,
    );
  }

  @Mutation('sellerDeleteProductCustomTextToken')
  sellerDeleteProductCustomTextToken(
    @CurrentUser() user: JwtUser,
    @Args('tokenId') tokenId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.templateService.sellerDeleteProductCustomTextToken(
      accountId,
      parseId(tokenId),
    );
  }

  @Mutation('sellerReorderProductCustomTextTokens')
  sellerReorderProductCustomTextTokens(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerReorderProductCustomTextTokensInput,
  ): Promise<SellerCustomTextTokenOutput[]> {
    const accountId = parseAccountId(user);
    return this.templateService.sellerReorderProductCustomTextTokens(
      accountId,
      input,
    );
  }
}
