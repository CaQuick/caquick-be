import type {
  AccountStatus,
  AccountType,
  BannerLinkType,
  BannerPlacement,
  CategoryType,
  IdentityProvider,
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
