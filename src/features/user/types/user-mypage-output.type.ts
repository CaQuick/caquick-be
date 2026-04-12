import type { OrderStatus } from '@prisma/client';

export interface MyPageCounts {
  customDraftCount: number;
  couponCount: number;
  wishlistCount: number;
  myReviewCount: number;
}

export interface OngoingOrderSummary {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  createdAt: Date;
  pickupAt: Date;
  representativeProductName: string;
  representativeProductImageUrl: string | null;
  totalPrice: number;
}

export interface RecentViewedProductSummary {
  productId: string;
  productName: string;
  representativeImageUrl: string | null;
  salePrice: number | null;
  regularPrice: number;
  storeName: string;
  viewedAt: Date;
}

export interface RecentViewedProductConnection {
  items: RecentViewedProductSummary[];
  totalCount: number;
  hasMore: boolean;
}

export interface MyPageOverview {
  counts: MyPageCounts;
  ongoingOrders: OngoingOrderSummary[];
  recentViewedProducts: RecentViewedProductSummary[];
}
