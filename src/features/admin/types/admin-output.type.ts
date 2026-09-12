import type {
  AccountStatus,
  AccountType,
  BannerLinkType,
  BannerPlacement,
  IdentityProvider,
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
