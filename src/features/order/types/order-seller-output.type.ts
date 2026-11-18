import type {
  OrderItemDetailOutput,
  OrderStatusHistoryOutput,
} from '@/features/order/types/order-output.type';
import type { OrderStatus, PaymentMethod } from '@/generated/prisma/client';

export interface SellerOrderSummaryOutput {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  pickupAt: Date;
  buyerName: string;
  buyerPhone: string;
  totalPrice: number;
  createdAt: Date;
  firstItemName: string | null;
  firstItemImageUrl: string | null;
}

export interface SellerOrderDetailOutput {
  id: string;
  orderNumber: string;
  accountId: string;
  status: OrderStatus;
  pickupAt: Date;
  buyerName: string;
  buyerPhone: string;
  requestNote: string | null;
  paymentMethod: PaymentMethod | null;
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
  items: OrderItemDetailOutput[];
  statusHistories: OrderStatusHistoryOutput[];
}

/** SDL SellerOrderUpdateKind. PICKUP_RESCHEDULED는 판매자 픽업 일시 변경이 발행한다. */
export type SellerOrderUpdateKind =
  'SUBMITTED' | 'STATUS_CHANGED' | 'PICKUP_RESCHEDULED';

/** 구독 이벤트 payload — Redis JSON 직렬화를 거치므로 날짜는 ISO 문자열. */
export interface SellerOrderUpdateEvent {
  kind: SellerOrderUpdateKind;
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  pickupAt: string;
  buyerName: string;
  totalPrice: number;
  productName: string;
  updatedAt: string;
}
