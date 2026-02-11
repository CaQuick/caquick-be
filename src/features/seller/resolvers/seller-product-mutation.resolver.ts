import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard, type JwtUser } from '../../../global/auth';
import { SellerService } from '../seller.service';
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
} from '../types/seller-input.type';
import type {
  SellerCustomTemplateOutput,
  SellerCustomTextTokenOutput,
  SellerOptionGroupOutput,
  SellerOptionItemOutput,
  SellerProductImageOutput,
  SellerProductOutput,
} from '../types/seller-output.type';

import { parseAccountId, parseId } from './seller-resolver.utils';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class SellerProductMutationResolver {
  constructor(private readonly sellerService: SellerService) {}

  @Mutation('sellerCreateProduct')
  sellerCreateProduct(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateProductInput,
  ): Promise<SellerProductOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerCreateProduct(accountId, input);
  }

  @Mutation('sellerUpdateProduct')
  sellerUpdateProduct(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateProductInput,
  ): Promise<SellerProductOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpdateProduct(accountId, input);
  }

  @Mutation('sellerDeleteProduct')
  sellerDeleteProduct(
    @CurrentUser() user: JwtUser,
    @Args('productId') productId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerDeleteProduct(
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
    return this.sellerService.sellerSetProductActive(accountId, input);
  }

  @Mutation('sellerAddProductImage')
  sellerAddProductImage(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerAddProductImageInput,
  ): Promise<SellerProductImageOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerAddProductImage(accountId, input);
  }

  @Mutation('sellerDeleteProductImage')
  sellerDeleteProductImage(
    @CurrentUser() user: JwtUser,
    @Args('imageId') imageId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerDeleteProductImage(
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
    return this.sellerService.sellerReorderProductImages(accountId, input);
  }

  @Mutation('sellerSetProductCategories')
  sellerSetProductCategories(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerSetProductCategoriesInput,
  ): Promise<SellerProductOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerSetProductCategories(accountId, input);
  }

  @Mutation('sellerSetProductTags')
  sellerSetProductTags(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerSetProductTagsInput,
  ): Promise<SellerProductOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerSetProductTags(accountId, input);
  }

  @Mutation('sellerCreateOptionGroup')
  sellerCreateOptionGroup(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateOptionGroupInput,
  ): Promise<SellerOptionGroupOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerCreateOptionGroup(accountId, input);
  }

  @Mutation('sellerUpdateOptionGroup')
  sellerUpdateOptionGroup(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateOptionGroupInput,
  ): Promise<SellerOptionGroupOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpdateOptionGroup(accountId, input);
  }

  @Mutation('sellerDeleteOptionGroup')
  sellerDeleteOptionGroup(
    @CurrentUser() user: JwtUser,
    @Args('optionGroupId') optionGroupId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerDeleteOptionGroup(
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
    return this.sellerService.sellerReorderOptionGroups(accountId, input);
  }

  @Mutation('sellerCreateOptionItem')
  sellerCreateOptionItem(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateOptionItemInput,
  ): Promise<SellerOptionItemOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerCreateOptionItem(accountId, input);
  }

  @Mutation('sellerUpdateOptionItem')
  sellerUpdateOptionItem(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateOptionItemInput,
  ): Promise<SellerOptionItemOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpdateOptionItem(accountId, input);
  }

  @Mutation('sellerDeleteOptionItem')
  sellerDeleteOptionItem(
    @CurrentUser() user: JwtUser,
    @Args('optionItemId') optionItemId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerDeleteOptionItem(
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
    return this.sellerService.sellerReorderOptionItems(accountId, input);
  }

  @Mutation('sellerUpsertProductCustomTemplate')
  sellerUpsertProductCustomTemplate(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertProductCustomTemplateInput,
  ): Promise<SellerCustomTemplateOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpsertProductCustomTemplate(
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
    return this.sellerService.sellerSetProductCustomTemplateActive(
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
    return this.sellerService.sellerUpsertProductCustomTextToken(
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
    return this.sellerService.sellerDeleteProductCustomTextToken(
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
    return this.sellerService.sellerReorderProductCustomTextTokens(
      accountId,
      input,
    );
  }
}
