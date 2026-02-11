import { Injectable } from '@nestjs/common';

import { SellerContentService } from './services/seller-content.service';
import { SellerConversationService } from './services/seller-conversation.service';
import { SellerOrderService } from './services/seller-order.service';
import { SellerProductService } from './services/seller-product.service';
import { SellerStoreService } from './services/seller-store.service';

@Injectable()
export class SellerService {
  constructor(
    private readonly storeService: SellerStoreService,
    private readonly productService: SellerProductService,
    private readonly orderService: SellerOrderService,
    private readonly conversationService: SellerConversationService,
    private readonly contentService: SellerContentService,
  ) {}

  sellerMyStore(
    ...args: Parameters<SellerStoreService['sellerMyStore']>
  ): ReturnType<SellerStoreService['sellerMyStore']> {
    return this.storeService.sellerMyStore(...args);
  }

  sellerStoreBusinessHours(
    ...args: Parameters<SellerStoreService['sellerStoreBusinessHours']>
  ): ReturnType<SellerStoreService['sellerStoreBusinessHours']> {
    return this.storeService.sellerStoreBusinessHours(...args);
  }

  sellerStoreSpecialClosures(
    ...args: Parameters<SellerStoreService['sellerStoreSpecialClosures']>
  ): ReturnType<SellerStoreService['sellerStoreSpecialClosures']> {
    return this.storeService.sellerStoreSpecialClosures(...args);
  }

  sellerStoreDailyCapacities(
    ...args: Parameters<SellerStoreService['sellerStoreDailyCapacities']>
  ): ReturnType<SellerStoreService['sellerStoreDailyCapacities']> {
    return this.storeService.sellerStoreDailyCapacities(...args);
  }

  sellerUpdateStoreBasicInfo(
    ...args: Parameters<SellerStoreService['sellerUpdateStoreBasicInfo']>
  ): ReturnType<SellerStoreService['sellerUpdateStoreBasicInfo']> {
    return this.storeService.sellerUpdateStoreBasicInfo(...args);
  }

  sellerUpsertStoreBusinessHour(
    ...args: Parameters<SellerStoreService['sellerUpsertStoreBusinessHour']>
  ): ReturnType<SellerStoreService['sellerUpsertStoreBusinessHour']> {
    return this.storeService.sellerUpsertStoreBusinessHour(...args);
  }

  sellerUpsertStoreSpecialClosure(
    ...args: Parameters<SellerStoreService['sellerUpsertStoreSpecialClosure']>
  ): ReturnType<SellerStoreService['sellerUpsertStoreSpecialClosure']> {
    return this.storeService.sellerUpsertStoreSpecialClosure(...args);
  }

  sellerDeleteStoreSpecialClosure(
    ...args: Parameters<SellerStoreService['sellerDeleteStoreSpecialClosure']>
  ): ReturnType<SellerStoreService['sellerDeleteStoreSpecialClosure']> {
    return this.storeService.sellerDeleteStoreSpecialClosure(...args);
  }

  sellerUpdatePickupPolicy(
    ...args: Parameters<SellerStoreService['sellerUpdatePickupPolicy']>
  ): ReturnType<SellerStoreService['sellerUpdatePickupPolicy']> {
    return this.storeService.sellerUpdatePickupPolicy(...args);
  }

  sellerUpsertStoreDailyCapacity(
    ...args: Parameters<SellerStoreService['sellerUpsertStoreDailyCapacity']>
  ): ReturnType<SellerStoreService['sellerUpsertStoreDailyCapacity']> {
    return this.storeService.sellerUpsertStoreDailyCapacity(...args);
  }

  sellerDeleteStoreDailyCapacity(
    ...args: Parameters<SellerStoreService['sellerDeleteStoreDailyCapacity']>
  ): ReturnType<SellerStoreService['sellerDeleteStoreDailyCapacity']> {
    return this.storeService.sellerDeleteStoreDailyCapacity(...args);
  }

  sellerProducts(
    ...args: Parameters<SellerProductService['sellerProducts']>
  ): ReturnType<SellerProductService['sellerProducts']> {
    return this.productService.sellerProducts(...args);
  }

  sellerProduct(
    ...args: Parameters<SellerProductService['sellerProduct']>
  ): ReturnType<SellerProductService['sellerProduct']> {
    return this.productService.sellerProduct(...args);
  }

  sellerCreateProduct(
    ...args: Parameters<SellerProductService['sellerCreateProduct']>
  ): ReturnType<SellerProductService['sellerCreateProduct']> {
    return this.productService.sellerCreateProduct(...args);
  }

  sellerUpdateProduct(
    ...args: Parameters<SellerProductService['sellerUpdateProduct']>
  ): ReturnType<SellerProductService['sellerUpdateProduct']> {
    return this.productService.sellerUpdateProduct(...args);
  }

  sellerDeleteProduct(
    ...args: Parameters<SellerProductService['sellerDeleteProduct']>
  ): ReturnType<SellerProductService['sellerDeleteProduct']> {
    return this.productService.sellerDeleteProduct(...args);
  }

  sellerSetProductActive(
    ...args: Parameters<SellerProductService['sellerSetProductActive']>
  ): ReturnType<SellerProductService['sellerSetProductActive']> {
    return this.productService.sellerSetProductActive(...args);
  }

  sellerAddProductImage(
    ...args: Parameters<SellerProductService['sellerAddProductImage']>
  ): ReturnType<SellerProductService['sellerAddProductImage']> {
    return this.productService.sellerAddProductImage(...args);
  }

  sellerDeleteProductImage(
    ...args: Parameters<SellerProductService['sellerDeleteProductImage']>
  ): ReturnType<SellerProductService['sellerDeleteProductImage']> {
    return this.productService.sellerDeleteProductImage(...args);
  }

  sellerReorderProductImages(
    ...args: Parameters<SellerProductService['sellerReorderProductImages']>
  ): ReturnType<SellerProductService['sellerReorderProductImages']> {
    return this.productService.sellerReorderProductImages(...args);
  }

  sellerSetProductCategories(
    ...args: Parameters<SellerProductService['sellerSetProductCategories']>
  ): ReturnType<SellerProductService['sellerSetProductCategories']> {
    return this.productService.sellerSetProductCategories(...args);
  }

  sellerSetProductTags(
    ...args: Parameters<SellerProductService['sellerSetProductTags']>
  ): ReturnType<SellerProductService['sellerSetProductTags']> {
    return this.productService.sellerSetProductTags(...args);
  }

  sellerCreateOptionGroup(
    ...args: Parameters<SellerProductService['sellerCreateOptionGroup']>
  ): ReturnType<SellerProductService['sellerCreateOptionGroup']> {
    return this.productService.sellerCreateOptionGroup(...args);
  }

  sellerUpdateOptionGroup(
    ...args: Parameters<SellerProductService['sellerUpdateOptionGroup']>
  ): ReturnType<SellerProductService['sellerUpdateOptionGroup']> {
    return this.productService.sellerUpdateOptionGroup(...args);
  }

  sellerDeleteOptionGroup(
    ...args: Parameters<SellerProductService['sellerDeleteOptionGroup']>
  ): ReturnType<SellerProductService['sellerDeleteOptionGroup']> {
    return this.productService.sellerDeleteOptionGroup(...args);
  }

  sellerReorderOptionGroups(
    ...args: Parameters<SellerProductService['sellerReorderOptionGroups']>
  ): ReturnType<SellerProductService['sellerReorderOptionGroups']> {
    return this.productService.sellerReorderOptionGroups(...args);
  }

  sellerCreateOptionItem(
    ...args: Parameters<SellerProductService['sellerCreateOptionItem']>
  ): ReturnType<SellerProductService['sellerCreateOptionItem']> {
    return this.productService.sellerCreateOptionItem(...args);
  }

  sellerUpdateOptionItem(
    ...args: Parameters<SellerProductService['sellerUpdateOptionItem']>
  ): ReturnType<SellerProductService['sellerUpdateOptionItem']> {
    return this.productService.sellerUpdateOptionItem(...args);
  }

  sellerDeleteOptionItem(
    ...args: Parameters<SellerProductService['sellerDeleteOptionItem']>
  ): ReturnType<SellerProductService['sellerDeleteOptionItem']> {
    return this.productService.sellerDeleteOptionItem(...args);
  }

  sellerReorderOptionItems(
    ...args: Parameters<SellerProductService['sellerReorderOptionItems']>
  ): ReturnType<SellerProductService['sellerReorderOptionItems']> {
    return this.productService.sellerReorderOptionItems(...args);
  }

  sellerUpsertProductCustomTemplate(
    ...args: Parameters<
      SellerProductService['sellerUpsertProductCustomTemplate']
    >
  ): ReturnType<SellerProductService['sellerUpsertProductCustomTemplate']> {
    return this.productService.sellerUpsertProductCustomTemplate(...args);
  }

  sellerSetProductCustomTemplateActive(
    ...args: Parameters<
      SellerProductService['sellerSetProductCustomTemplateActive']
    >
  ): ReturnType<SellerProductService['sellerSetProductCustomTemplateActive']> {
    return this.productService.sellerSetProductCustomTemplateActive(...args);
  }

  sellerUpsertProductCustomTextToken(
    ...args: Parameters<
      SellerProductService['sellerUpsertProductCustomTextToken']
    >
  ): ReturnType<SellerProductService['sellerUpsertProductCustomTextToken']> {
    return this.productService.sellerUpsertProductCustomTextToken(...args);
  }

  sellerDeleteProductCustomTextToken(
    ...args: Parameters<
      SellerProductService['sellerDeleteProductCustomTextToken']
    >
  ): ReturnType<SellerProductService['sellerDeleteProductCustomTextToken']> {
    return this.productService.sellerDeleteProductCustomTextToken(...args);
  }

  sellerReorderProductCustomTextTokens(
    ...args: Parameters<
      SellerProductService['sellerReorderProductCustomTextTokens']
    >
  ): ReturnType<SellerProductService['sellerReorderProductCustomTextTokens']> {
    return this.productService.sellerReorderProductCustomTextTokens(...args);
  }

  sellerOrderList(
    ...args: Parameters<SellerOrderService['sellerOrderList']>
  ): ReturnType<SellerOrderService['sellerOrderList']> {
    return this.orderService.sellerOrderList(...args);
  }

  sellerOrder(
    ...args: Parameters<SellerOrderService['sellerOrder']>
  ): ReturnType<SellerOrderService['sellerOrder']> {
    return this.orderService.sellerOrder(...args);
  }

  sellerUpdateOrderStatus(
    ...args: Parameters<SellerOrderService['sellerUpdateOrderStatus']>
  ): ReturnType<SellerOrderService['sellerUpdateOrderStatus']> {
    return this.orderService.sellerUpdateOrderStatus(...args);
  }

  sellerConversations(
    ...args: Parameters<SellerConversationService['sellerConversations']>
  ): ReturnType<SellerConversationService['sellerConversations']> {
    return this.conversationService.sellerConversations(...args);
  }

  sellerConversationMessages(
    ...args: Parameters<SellerConversationService['sellerConversationMessages']>
  ): ReturnType<SellerConversationService['sellerConversationMessages']> {
    return this.conversationService.sellerConversationMessages(...args);
  }

  sellerSendConversationMessage(
    ...args: Parameters<
      SellerConversationService['sellerSendConversationMessage']
    >
  ): ReturnType<SellerConversationService['sellerSendConversationMessage']> {
    return this.conversationService.sellerSendConversationMessage(...args);
  }

  sellerFaqTopics(
    ...args: Parameters<SellerContentService['sellerFaqTopics']>
  ): ReturnType<SellerContentService['sellerFaqTopics']> {
    return this.contentService.sellerFaqTopics(...args);
  }

  sellerCreateFaqTopic(
    ...args: Parameters<SellerContentService['sellerCreateFaqTopic']>
  ): ReturnType<SellerContentService['sellerCreateFaqTopic']> {
    return this.contentService.sellerCreateFaqTopic(...args);
  }

  sellerUpdateFaqTopic(
    ...args: Parameters<SellerContentService['sellerUpdateFaqTopic']>
  ): ReturnType<SellerContentService['sellerUpdateFaqTopic']> {
    return this.contentService.sellerUpdateFaqTopic(...args);
  }

  sellerDeleteFaqTopic(
    ...args: Parameters<SellerContentService['sellerDeleteFaqTopic']>
  ): ReturnType<SellerContentService['sellerDeleteFaqTopic']> {
    return this.contentService.sellerDeleteFaqTopic(...args);
  }

  sellerBanners(
    ...args: Parameters<SellerContentService['sellerBanners']>
  ): ReturnType<SellerContentService['sellerBanners']> {
    return this.contentService.sellerBanners(...args);
  }

  sellerCreateBanner(
    ...args: Parameters<SellerContentService['sellerCreateBanner']>
  ): ReturnType<SellerContentService['sellerCreateBanner']> {
    return this.contentService.sellerCreateBanner(...args);
  }

  sellerUpdateBanner(
    ...args: Parameters<SellerContentService['sellerUpdateBanner']>
  ): ReturnType<SellerContentService['sellerUpdateBanner']> {
    return this.contentService.sellerUpdateBanner(...args);
  }

  sellerDeleteBanner(
    ...args: Parameters<SellerContentService['sellerDeleteBanner']>
  ): ReturnType<SellerContentService['sellerDeleteBanner']> {
    return this.contentService.sellerDeleteBanner(...args);
  }

  sellerAuditLogs(
    ...args: Parameters<SellerContentService['sellerAuditLogs']>
  ): ReturnType<SellerContentService['sellerAuditLogs']> {
    return this.contentService.sellerAuditLogs(...args);
  }
}
