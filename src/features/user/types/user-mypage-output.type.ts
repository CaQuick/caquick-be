import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { ProductCardOutput } from '@/features/product';
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

export interface RecentViewedProduct {
  product: ProductCardOutput;
  viewedAt: Date;
}

export type RecentViewedProductConnection =
  OffsetConnection<RecentViewedProduct>;

export interface MyPageOverview {
  counts: MyPageCounts;
  ongoingOrders: OngoingOrderSummary[];
  recentViewedProducts: RecentViewedProduct[];
}
