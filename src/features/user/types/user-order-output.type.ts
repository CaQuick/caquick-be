import type { OrderStatus } from '@prisma/client';

export interface MyOrderSummary {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  createdAt: Date;
  pickupAt: Date;
  representativeProductName: string;
  representativeProductImageUrl: string | null;
  additionalItemCount: number;
  totalPrice: number;
  storeName: string;
}

export interface MyOrderConnection {
  items: MyOrderSummary[];
  totalCount: number;
  hasMore: boolean;
}
