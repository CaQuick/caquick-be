export interface SellerCursorInput {
  limit?: number | null;
  cursor?: string | null;
}

export interface SellerDateCursorInput extends SellerCursorInput {
  fromDate?: Date | string | null;
  toDate?: Date | string | null;
}

export interface SellerProductListInput extends SellerCursorInput {
  isActive?: boolean | null;
  categoryId?: string | null;
  search?: string | null;
}

export interface SellerOrderListInput extends SellerCursorInput {
  status?: 'SUBMITTED' | 'CONFIRMED' | 'MADE' | 'PICKED_UP' | 'CANCELED' | null;
  fromCreatedAt?: Date | string | null;
  toCreatedAt?: Date | string | null;
  fromPickupAt?: Date | string | null;
  toPickupAt?: Date | string | null;
  search?: string | null;
}

export interface SellerUpdateStoreBasicInfoInput {
  storeName?: string;
  storePhone?: string;
  addressFull?: string;
  addressCity?: string | null;
  addressDistrict?: string | null;
  addressNeighborhood?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  mapProvider?: 'NAVER' | 'KAKAO' | 'NONE' | null;
  websiteUrl?: string | null;
  businessHoursText?: string | null;
}

export interface SellerUpsertStoreBusinessHourInput {
  dayOfWeek: number;
  isClosed: boolean;
  openTime?: Date | string | null;
  closeTime?: Date | string | null;
}

export interface SellerUpsertStoreSpecialClosureInput {
  closureId?: string | null;
  closureDate: Date | string;
  reason?: string | null;
}

export interface SellerUpdatePickupPolicyInput {
  pickupSlotIntervalMinutes: number;
  minLeadTimeMinutes: number;
  maxDaysAhead: number;
}

export interface SellerUpsertStoreDailyCapacityInput {
  capacityId?: string | null;
  capacityDate: Date | string;
  capacity: number;
}

export interface SellerCreateProductInput {
  name: string;
  initialImageUrl: string;
  description?: string | null;
  purchaseNotice?: string | null;
  regularPrice: number;
  salePrice?: number | null;
  currency?: string | null;
  baseDesignImageUrl?: string | null;
  preparationTimeMinutes?: number | null;
  isActive?: boolean | null;
}

export interface SellerUpdateProductInput {
  productId: string;
  name?: string;
  description?: string | null;
  purchaseNotice?: string | null;
  regularPrice?: number;
  salePrice?: number | null;
  currency?: string;
  baseDesignImageUrl?: string | null;
  preparationTimeMinutes?: number;
}

export interface SellerSetProductActiveInput {
  productId: string;
  isActive: boolean;
}

export interface SellerAddProductImageInput {
  productId: string;
  imageUrl: string;
  sortOrder?: number | null;
}

export interface SellerReorderProductImagesInput {
  productId: string;
  imageIds: string[];
}

export interface SellerSetProductCategoriesInput {
  productId: string;
  categoryIds: string[];
}

export interface SellerSetProductTagsInput {
  productId: string;
  tagIds: string[];
}

export interface SellerCreateOptionGroupInput {
  productId: string;
  name: string;
  isRequired?: boolean | null;
  minSelect?: number | null;
  maxSelect?: number | null;
  optionRequiresDescription?: boolean | null;
  optionRequiresImage?: boolean | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

export interface SellerUpdateOptionGroupInput {
  optionGroupId: string;
  name?: string;
  isRequired?: boolean;
  minSelect?: number;
  maxSelect?: number;
  optionRequiresDescription?: boolean;
  optionRequiresImage?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}

export interface SellerReorderOptionGroupsInput {
  productId: string;
  optionGroupIds: string[];
}

export interface SellerCreateOptionItemInput {
  optionGroupId: string;
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  priceDelta?: number | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

export interface SellerUpdateOptionItemInput {
  optionItemId: string;
  title?: string;
  description?: string | null;
  imageUrl?: string | null;
  priceDelta?: number;
  sortOrder?: number;
  isActive?: boolean;
}

export interface SellerReorderOptionItemsInput {
  optionGroupId: string;
  optionItemIds: string[];
}

export interface SellerUpsertProductCustomTemplateInput {
  productId: string;
  baseImageUrl: string;
  isActive?: boolean | null;
}

export interface SellerSetProductCustomTemplateActiveInput {
  templateId: string;
  isActive: boolean;
}

export interface SellerUpsertProductCustomTextTokenInput {
  tokenId?: string | null;
  templateId: string;
  tokenKey: string;
  defaultText: string;
  maxLength?: number | null;
  sortOrder?: number | null;
  isRequired?: boolean | null;
  posX?: number | null;
  posY?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface SellerReorderProductCustomTextTokensInput {
  templateId: string;
  tokenIds: string[];
}

export interface SellerUpdateOrderStatusInput {
  orderId: string;
  toStatus: 'SUBMITTED' | 'CONFIRMED' | 'MADE' | 'PICKED_UP' | 'CANCELED';
  note?: string | null;
}

export interface SellerSendConversationMessageInput {
  conversationId: string;
  bodyFormat: 'TEXT' | 'HTML';
  bodyText?: string | null;
  bodyHtml?: string | null;
}

export interface SellerCreateFaqTopicInput {
  title: string;
  answerHtml: string;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

export interface SellerUpdateFaqTopicInput {
  topicId: string;
  title?: string;
  answerHtml?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface SellerCreateBannerInput {
  placement: 'HOME_MAIN' | 'HOME_SUB' | 'CATEGORY' | 'STORE';
  title?: string | null;
  imageUrl: string;
  linkType?: 'NONE' | 'URL' | 'PRODUCT' | 'STORE' | 'CATEGORY' | null;
  linkUrl?: string | null;
  linkProductId?: string | null;
  linkStoreId?: string | null;
  linkCategoryId?: string | null;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

export interface SellerUpdateBannerInput {
  bannerId: string;
  placement?: 'HOME_MAIN' | 'HOME_SUB' | 'CATEGORY' | 'STORE';
  title?: string | null;
  imageUrl?: string;
  linkType?: 'NONE' | 'URL' | 'PRODUCT' | 'STORE' | 'CATEGORY';
  linkUrl?: string | null;
  linkProductId?: string | null;
  linkStoreId?: string | null;
  linkCategoryId?: string | null;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface SellerAuditLogListInput extends SellerCursorInput {
  targetType?:
    | 'STORE'
    | 'PRODUCT'
    | 'ORDER'
    | 'CONVERSATION'
    | 'CHANGE_PASSWORD'
    | null;
}
