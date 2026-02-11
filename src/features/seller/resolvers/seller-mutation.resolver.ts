import { BadRequestException, UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard, type JwtUser } from '../../../global/auth';
import { SellerService } from '../seller.service';
import type {
  SellerAddProductImageInput,
  SellerCreateBannerInput,
  SellerCreateFaqTopicInput,
  SellerCreateOptionGroupInput,
  SellerCreateOptionItemInput,
  SellerCreateProductInput,
  SellerReorderOptionGroupsInput,
  SellerReorderOptionItemsInput,
  SellerReorderProductCustomTextTokensInput,
  SellerReorderProductImagesInput,
  SellerSendConversationMessageInput,
  SellerSetProductActiveInput,
  SellerSetProductCategoriesInput,
  SellerSetProductCustomTemplateActiveInput,
  SellerSetProductTagsInput,
  SellerUpdateBannerInput,
  SellerUpdateFaqTopicInput,
  SellerUpdateOptionGroupInput,
  SellerUpdateOptionItemInput,
  SellerUpdateOrderStatusInput,
  SellerUpdatePickupPolicyInput,
  SellerUpdateProductInput,
  SellerUpdateStoreBasicInfoInput,
  SellerUpsertProductCustomTemplateInput,
  SellerUpsertProductCustomTextTokenInput,
  SellerUpsertStoreBusinessHourInput,
  SellerUpsertStoreDailyCapacityInput,
  SellerUpsertStoreSpecialClosureInput,
} from '../types/seller-input.type';
import type {
  SellerBannerOutput,
  SellerConversationMessageOutput,
  SellerCustomTemplateOutput,
  SellerCustomTextTokenOutput,
  SellerFaqTopicOutput,
  SellerOptionGroupOutput,
  SellerOptionItemOutput,
  SellerOrderSummaryOutput,
  SellerProductImageOutput,
  SellerProductOutput,
  SellerStoreBusinessHourOutput,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
  SellerStoreSpecialClosureOutput,
} from '../types/seller-output.type';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class SellerMutationResolver {
  constructor(private readonly sellerService: SellerService) {}

  @Mutation('sellerUpdateStoreBasicInfo')
  sellerUpdateStoreBasicInfo(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateStoreBasicInfoInput,
  ): Promise<SellerStoreOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpdateStoreBasicInfo(accountId, input);
  }

  @Mutation('sellerUpsertStoreBusinessHour')
  sellerUpsertStoreBusinessHour(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertStoreBusinessHourInput,
  ): Promise<SellerStoreBusinessHourOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpsertStoreBusinessHour(accountId, input);
  }

  @Mutation('sellerUpsertStoreSpecialClosure')
  sellerUpsertStoreSpecialClosure(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertStoreSpecialClosureInput,
  ): Promise<SellerStoreSpecialClosureOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpsertStoreSpecialClosure(accountId, input);
  }

  @Mutation('sellerDeleteStoreSpecialClosure')
  sellerDeleteStoreSpecialClosure(
    @CurrentUser() user: JwtUser,
    @Args('closureId') closureId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerDeleteStoreSpecialClosure(
      accountId,
      parseId(closureId),
    );
  }

  @Mutation('sellerUpdatePickupPolicy')
  sellerUpdatePickupPolicy(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdatePickupPolicyInput,
  ): Promise<SellerStoreOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpdatePickupPolicy(accountId, input);
  }

  @Mutation('sellerUpsertStoreDailyCapacity')
  sellerUpsertStoreDailyCapacity(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpsertStoreDailyCapacityInput,
  ): Promise<SellerStoreDailyCapacityOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpsertStoreDailyCapacity(accountId, input);
  }

  @Mutation('sellerDeleteStoreDailyCapacity')
  sellerDeleteStoreDailyCapacity(
    @CurrentUser() user: JwtUser,
    @Args('capacityId') capacityId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerDeleteStoreDailyCapacity(
      accountId,
      parseId(capacityId),
    );
  }

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

  @Mutation('sellerUpdateOrderStatus')
  sellerUpdateOrderStatus(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateOrderStatusInput,
  ): Promise<SellerOrderSummaryOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpdateOrderStatus(accountId, input);
  }

  @Mutation('sellerSendConversationMessage')
  sellerSendConversationMessage(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerSendConversationMessageInput,
  ): Promise<SellerConversationMessageOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerSendConversationMessage(accountId, input);
  }

  @Mutation('sellerCreateFaqTopic')
  sellerCreateFaqTopic(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerCreateFaqTopic(accountId, input);
  }

  @Mutation('sellerUpdateFaqTopic')
  sellerUpdateFaqTopic(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpdateFaqTopic(accountId, input);
  }

  @Mutation('sellerDeleteFaqTopic')
  sellerDeleteFaqTopic(
    @CurrentUser() user: JwtUser,
    @Args('topicId') topicId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerDeleteFaqTopic(accountId, parseId(topicId));
  }

  @Mutation('sellerCreateBanner')
  sellerCreateBanner(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateBannerInput,
  ): Promise<SellerBannerOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerCreateBanner(accountId, input);
  }

  @Mutation('sellerUpdateBanner')
  sellerUpdateBanner(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateBannerInput,
  ): Promise<SellerBannerOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpdateBanner(accountId, input);
  }

  @Mutation('sellerDeleteBanner')
  sellerDeleteBanner(
    @CurrentUser() user: JwtUser,
    @Args('bannerId') bannerId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerDeleteBanner(accountId, parseId(bannerId));
  }
}

function parseAccountId(user: JwtUser): bigint {
  try {
    return BigInt(user.accountId);
  } catch {
    throw new BadRequestException('Invalid account id.');
  }
}

function parseId(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new BadRequestException('Invalid id.');
  }
}
