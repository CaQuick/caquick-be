export interface SellerStoreOutput {
  id: string;
  sellerAccountId: string;
  storeName: string;
  storePhone: string;
  addressFull: string;
  addressCity: string | null;
  addressDistrict: string | null;
  addressNeighborhood: string | null;
  latitude: string | null;
  longitude: string | null;
  mapProvider: 'NAVER' | 'KAKAO' | 'NONE';
  websiteUrl: string | null;
  businessHoursText: string | null;
  pickupSlotIntervalMinutes: number;
  minLeadTimeMinutes: number;
  maxDaysAhead: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerStoreBusinessHourOutput {
  id: string;
  dayOfWeek: number;
  isClosed: boolean;
  openTime: Date | null;
  closeTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerStoreSpecialClosureOutput {
  id: string;
  closureDate: Date;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerStoreDailyCapacityOutput {
  id: string;
  capacityDate: Date;
  capacity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerCategoryOutput {
  id: string;
  name: string;
}

export interface SellerTagOutput {
  id: string;
  name: string;
}

export interface SellerProductImageOutput {
  id: string;
  imageUrl: string;
  sortOrder: number;
}

export interface SellerOptionItemOutput {
  id: string;
  optionGroupId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  priceDelta: number;
  sortOrder: number;
  isActive: boolean;
}

export interface SellerOptionGroupOutput {
  id: string;
  productId: string;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  optionRequiresDescription: boolean;
  optionRequiresImage: boolean;
  sortOrder: number;
  isActive: boolean;
  optionItems: SellerOptionItemOutput[];
}

export interface SellerCustomTextTokenOutput {
  id: string;
  templateId: string;
  tokenKey: string;
  defaultText: string;
  maxLength: number;
  sortOrder: number;
  isRequired: boolean;
  posX: number | null;
  posY: number | null;
  width: number | null;
  height: number | null;
}

export interface SellerCustomTemplateOutput {
  id: string;
  productId: string;
  baseImageUrl: string;
  isActive: boolean;
  textTokens: SellerCustomTextTokenOutput[];
}

export interface SellerProductOutput {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  purchaseNotice: string | null;
  regularPrice: number;
  salePrice: number | null;
  currency: string;
  baseDesignImageUrl: string | null;
  preparationTimeMinutes: number;
  isActive: boolean;
  images: SellerProductImageOutput[];
  categories: SellerCategoryOutput[];
  tags: SellerTagOutput[];
  optionGroups: SellerOptionGroupOutput[];
  customTemplate: SellerCustomTemplateOutput | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerOrderSummaryOutput {
  id: string;
  orderNumber: string;
  status: 'SUBMITTED' | 'CONFIRMED' | 'MADE' | 'PICKED_UP' | 'CANCELED';
  pickupAt: Date;
  buyerName: string;
  buyerPhone: string;
  totalPrice: number;
  createdAt: Date;
}

export interface SellerOrderStatusHistoryOutput {
  id: string;
  fromStatus:
    | 'SUBMITTED'
    | 'CONFIRMED'
    | 'MADE'
    | 'PICKED_UP'
    | 'CANCELED'
    | null;
  toStatus: 'SUBMITTED' | 'CONFIRMED' | 'MADE' | 'PICKED_UP' | 'CANCELED';
  changedAt: Date;
  note: string | null;
}

export interface SellerOrderItemOptionSnapshotOutput {
  id: string;
  groupNameSnapshot: string;
  optionTitleSnapshot: string;
  optionPriceDeltaSnapshot: number;
}

export interface SellerOrderItemCustomTextSnapshotOutput {
  id: string;
  tokenKeySnapshot: string;
  defaultTextSnapshot: string;
  valueText: string;
  sortOrder: number;
}

export interface SellerOrderItemCustomFreeEditAttachmentOutput {
  id: string;
  imageUrl: string;
  sortOrder: number;
}

export interface SellerOrderItemCustomFreeEditSnapshotOutput {
  id: string;
  cropImageUrl: string;
  descriptionText: string;
  sortOrder: number;
  attachments: SellerOrderItemCustomFreeEditAttachmentOutput[];
}

export interface SellerOrderItemDetailOutput {
  id: string;
  storeId: string;
  productId: string;
  productNameSnapshot: string;
  regularPriceSnapshot: number;
  salePriceSnapshot: number | null;
  quantity: number;
  itemSubtotalPrice: number;
  optionItems: SellerOrderItemOptionSnapshotOutput[];
  customTexts: SellerOrderItemCustomTextSnapshotOutput[];
  freeEdits: SellerOrderItemCustomFreeEditSnapshotOutput[];
}

export interface SellerOrderDetailOutput {
  id: string;
  orderNumber: string;
  accountId: string;
  status: 'SUBMITTED' | 'CONFIRMED' | 'MADE' | 'PICKED_UP' | 'CANCELED';
  pickupAt: Date;
  buyerName: string;
  buyerPhone: string;
  subtotalPrice: number;
  discountPrice: number;
  totalPrice: number;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  madeAt: Date | null;
  pickedUpAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: SellerOrderItemDetailOutput[];
  statusHistories: SellerOrderStatusHistoryOutput[];
}

export interface SellerConversationOutput {
  id: string;
  accountId: string;
  storeId: string;
  lastMessageAt: Date | null;
  lastReadAt: Date | null;
  updatedAt: Date;
}

export interface SellerConversationMessageOutput {
  id: string;
  conversationId: string;
  senderType: 'USER' | 'STORE' | 'SYSTEM';
  senderAccountId: string | null;
  bodyFormat: 'TEXT' | 'HTML';
  bodyText: string | null;
  bodyHtml: string | null;
  createdAt: Date;
}

export interface SellerFaqTopicOutput {
  id: string;
  storeId: string;
  title: string;
  answerHtml: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerBannerOutput {
  id: string;
  placement: 'HOME_MAIN' | 'HOME_SUB' | 'CATEGORY' | 'STORE';
  title: string | null;
  imageUrl: string;
  linkType: 'NONE' | 'URL' | 'PRODUCT' | 'STORE' | 'CATEGORY';
  linkUrl: string | null;
  linkProductId: string | null;
  linkStoreId: string | null;
  linkCategoryId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerAuditLogOutput {
  id: string;
  actorAccountId: string;
  storeId: string | null;
  targetType:
    | 'STORE'
    | 'PRODUCT'
    | 'ORDER'
    | 'CONVERSATION'
    | 'CHANGE_PASSWORD';
  targetId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE';
  beforeJson: string | null;
  afterJson: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface SellerCursorConnection<T> {
  items: T[];
  nextCursor: string | null;
}
