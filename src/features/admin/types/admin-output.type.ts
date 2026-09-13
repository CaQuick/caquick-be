import type {
  AccountStatus,
  AccountType,
  AuditActionType,
  AuditTargetType,
  BannerLinkType,
  BannerPlacement,
  CategoryType,
  IdentityProvider,
  OrderStatus,
  ReviewReportReason,
  ReviewReportStatus,
  StoreMapProvider,
} from '@prisma/client';

export interface AdminAccountOutput {
  accountId: string;
  username: string | null;
  email: string | null;
  name: string | null;
  status: AccountStatus;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AdminCursorConnection<T> {
  items: T[];
  nextCursor: string | null;
  /** 다음 페이지 존재 여부. limit+1 조회 결과로 판정하므로 추가 쿼리가 없다. */
  hasMore: boolean;
  /** 조건에 맞는 전체 건수. 누적형 로그처럼 COUNT가 부담인 목록은 내리지 않는다. */
  totalCount?: number;
}

export interface AdminBannerOutput {
  id: string;
  placement: BannerPlacement;
  title: string | null;
  imageUrl: string;
  linkType: BannerLinkType;
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

export interface AdminSellerOutput {
  accountId: string;
  username: string | null;
  email: string | null;
  name: string | null;
  status: AccountStatus;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  profile: {
    businessName: string;
    businessPhone: string;
    websiteUrl: string | null;
  } | null;
  store: {
    id: string;
    storeName: string;
    storePhone: string;
    addressFull: string;
    isActive: boolean;
  } | null;
  createdAt: Date;
}

export interface AdminUserOutput {
  accountId: string;
  email: string | null;
  name: string | null;
  status: AccountStatus;
  nickname: string | null;
  phoneNumber: string | null;
  onboardingCompleted: boolean;
  identityProviders: IdentityProvider[];
  orderCount: number;
  reviewCount: number;
  createdAt: Date;
}

export interface AdminAccountStatusResultOutput {
  accountId: string;
  accountType: AccountType;
  status: AccountStatus;
}

export interface AdminStoreOutput {
  id: string;
  sellerAccountId: string;
  storeName: string;
  storePhone: string;
  addressFull: string;
  addressCity: string | null;
  addressDistrict: string | null;
  addressNeighborhood: string | null;
  regionId: string | null;
  latitude: string | null;
  longitude: string | null;
  mapProvider: StoreMapProvider;
  websiteUrl: string | null;
  businessHoursText: string | null;
  profileImageUrl: string | null;
  greetingMessage: string | null;
  pickupSlotIntervalMinutes: number;
  minLeadTimeMinutes: number;
  maxDaysAhead: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminStoreDetailOutput {
  store: AdminStoreOutput;
  seller: {
    accountId: string;
    username: string | null;
    email: string | null;
    name: string | null;
    status: AccountStatus;
  };
  productCount: number;
  orderItemCount: number;
}

export interface AdminProductOutput {
  id: string;
  storeId: string;
  storeName: string;
  name: string;
  regularPrice: number;
  salePrice: number | null;
  currency: string;
  baseDesignImageUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminProductDetailOutput {
  product: AdminProductOutput;
  storeIsActive: boolean;
  description: string | null;
  purchaseNotice: string | null;
  preparationTimeMinutes: number;
  imageUrls: string[];
  reviewCount: number;
  orderItemCount: number;
}

export interface AdminCategoryOutput {
  id: string;
  categoryType: CategoryType;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminTagOutput {
  id: string;
  name: string;
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminReviewReportOutput {
  id: string;
  targetType: 'REVIEW' | 'REVIEW_COMMENT';
  targetId: string;
  reporterAccountId: string;
  reason: ReviewReportReason;
  detail: string | null;
  contentSnapshot: string | null;
  status: ReviewReportStatus;
  resolvedByAccountId: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
}

export interface AdminReviewReportDetailOutput {
  report: AdminReviewReportOutput;
  target: {
    id: string;
    reviewId: string | null;
    authorAccountId: string;
    authorNickname: string | null;
    content: string | null;
    storeId: string;
    deleted: boolean;
  };
}

export interface AdminReviewOutput {
  id: string;
  storeId: string;
  storeName: string;
  productId: string;
  authorAccountId: string;
  authorNickname: string | null;
  rating: string;
  content: string | null;
  commentCount: number;
  likeCount: number;
  deleted: boolean;
  createdAt: Date;
}

export interface AdminReviewCommentOutput {
  id: string;
  reviewId: string;
  authorAccountId: string;
  authorNickname: string | null;
  content: string;
  deleted: boolean;
  createdAt: Date;
}

export interface AdminOrderSummaryOutput {
  id: string;
  orderNumber: string;
  accountId: string;
  storeId: string | null;
  status: OrderStatus;
  pickupAt: Date;
  buyerName: string;
  buyerPhone: string;
  totalPrice: number;
  createdAt: Date;
}

export interface AdminOrderItemDetailOutput {
  id: string;
  storeId: string;
  productId: string;
  productNameSnapshot: string;
  regularPriceSnapshot: number;
  salePriceSnapshot: number | null;
  quantity: number;
  itemSubtotalPrice: number;
  optionItems: {
    id: string;
    groupNameSnapshot: string;
    optionTitleSnapshot: string;
    optionPriceDeltaSnapshot: number;
  }[];
  customTexts: {
    id: string;
    tokenKeySnapshot: string;
    defaultTextSnapshot: string;
    valueText: string;
    sortOrder: number;
  }[];
  freeEdits: {
    id: string;
    cropImageUrl: string;
    descriptionText: string;
    sortOrder: number;
    attachments: { id: string; imageUrl: string; sortOrder: number }[];
  }[];
}

export interface AdminOrderDetailOutput {
  id: string;
  orderNumber: string;
  buyer: {
    accountId: string;
    email: string | null;
    nickname: string | null;
    status: AccountStatus;
  };
  status: OrderStatus;
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
  items: AdminOrderItemDetailOutput[];
  statusHistories: {
    id: string;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    changedAt: Date;
    note: string | null;
  }[];
}

export interface AdminSendNotificationResultOutput {
  sentCount: number;
  skippedAccountIds: string[];
}

export interface AdminRegionOutput {
  id: string;
  parentId: string | null;
  level: number;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  centerLat: string | null;
  centerLng: string | null;
  storeCount: number;
  childCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAuditLogOutput {
  id: string;
  actorAccountId: string;
  actorAccountType: AccountType | null;
  storeId: string | null;
  targetType: AuditTargetType;
  targetId: string;
  action: AuditActionType;
  beforeJson: string | null;
  afterJson: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface AdminDashboardSummaryOutput {
  from: Date;
  to: Date;
  newUserCount: number;
  newSellerCount: number;
  orderCounts: {
    submitted: number;
    confirmed: number;
    made: number;
    pickedUp: number;
    canceled: number;
  };
  orderAmountSum: number;
  activeStoreCount: number;
  activeProductCount: number;
  pendingReportCount: number;
}

export interface AdminSearchKeywordSnapshotOutput {
  rankedAt: Date | null;
  items: { rank: number; keyword: string; searchCount: number }[];
}
