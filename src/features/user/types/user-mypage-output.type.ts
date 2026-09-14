import type { ProductCardCore } from '@/features/product';
import type { OrderStatus } from '@/generated/prisma/client';

export interface MyPageCounts {
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

export interface RecentViewedProductSummary extends ProductCardCore {
  viewedAt: Date;
  isWishlisted: boolean;
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
