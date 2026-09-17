import type { OffsetConnection } from '@/common/types/cursor-connection.type';
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

export interface RecentViewedProductSummary {
  productId: string;
  productName: string;
  representativeImageUrl: string | null;
  salePrice: number | null;
  regularPrice: number;
  storeName: string;
  viewedAt: Date;
  isWishlisted: boolean;
}

export type RecentViewedProductConnection =
  OffsetConnection<RecentViewedProductSummary>;

export interface MyPageOverview {
  counts: MyPageCounts;
  ongoingOrders: OngoingOrderSummary[];
  recentViewedProducts: RecentViewedProductSummary[];
}
