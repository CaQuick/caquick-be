import type {
  OrderItemDetailOutput,
  OrderStatusHistoryOutput,
} from '@/features/order/types/order-output.type';

export interface SellerOrderSummaryOutput {
  id: string;
  orderNumber: string;
  status: 'SUBMITTED' | 'CONFIRMED' | 'MADE' | 'PICKED_UP' | 'CANCELED';
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
  status: 'SUBMITTED' | 'CONFIRMED' | 'MADE' | 'PICKED_UP' | 'CANCELED';
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
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemDetailOutput[];
  statusHistories: OrderStatusHistoryOutput[];
}

/** 구독 이벤트 payload — Redis JSON 직렬화를 거치므로 날짜는 ISO 문자열. */
export interface SellerOrderUpdateEvent {
  orderId: string;
  orderNumber: string;
  status: 'SUBMITTED' | 'CONFIRMED' | 'MADE' | 'PICKED_UP' | 'CANCELED';
  pickupAt: string;
  buyerName: string;
  totalPrice: number;
  productName: string;
  updatedAt: string;
}
