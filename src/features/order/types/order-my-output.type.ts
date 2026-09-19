import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type {
  OrderItemDetailOutput,
  OrderStatusHistoryOutput,
} from '@/features/order/types/order-output.type';
import type { OrderStatus } from '@/generated/prisma/client';

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
  hasReviewableItem: boolean;
}

export type MyOrderConnection = OffsetConnection<MyOrderSummary>;

export interface MyOrderItem {
  item: OrderItemDetailOutput;
  representativeImageUrl: string | null;
  hasMyReview: boolean;
  canWriteReview: boolean;
}

export interface MyOrderStoreInfo {
  storeId: string;
  storeName: string;
  storePhone: string;
  addressFull: string;
  addressCity: string | null;
  addressDistrict: string | null;
  addressNeighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  businessHoursText: string | null;
  websiteUrl: string | null;
}

export interface MyOrderDetail {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  createdAt: Date;
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
  statusHistories: OrderStatusHistoryOutput[];
  items: MyOrderItem[];
  store: MyOrderStoreInfo;
}
