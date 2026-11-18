import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type {
  OrderCancellationOutput,
  OrderItemDetailOutput,
  OrderStatusHistoryOutput,
} from '@/features/order/types/order-output.type';
import type { OrderPaymentOutput } from '@/features/order/types/order-payment-output.type';
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
  discountRate: number;
  totalPrice: number;
  storeName: string;
  regionLabel: string | null;
  hasReviewableItem: boolean;
  paymentExpiresAt: Date | null;
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
  requestNote: string | null;
  payment: OrderPaymentOutput | null;
  subtotalPrice: number;
  discountPrice: number;
  totalPrice: number;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  madeAt: Date | null;
  pickedUpAt: Date | null;
  canceledAt: Date | null;
  cancellation: OrderCancellationOutput | null;
  canCancel: boolean;
  statusHistories: OrderStatusHistoryOutput[];
  items: MyOrderItem[];
  store: MyOrderStoreInfo;
}
