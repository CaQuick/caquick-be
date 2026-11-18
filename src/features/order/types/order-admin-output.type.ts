import type { CancelRefundRule } from '@/features/order/policies/order-cancel.policy';
import type {
  OrderAutoTransitionTimes,
  OrderCancellationOutput,
  OrderItemDetailOutput,
  OrderPickupChangeOutput,
  OrderRefundOutput,
  OrderStatusHistoryOutput,
} from '@/features/order/types/order-output.type';
import type { AdminOrderPaymentOutput } from '@/features/order/types/order-payment-output.type';
import type { OrderSettlementFieldsOutput } from '@/features/order/types/order-settlement-output.type';
import type {
  AccountStatus,
  OrderCancelReason,
  OrderStatus,
} from '@/generated/prisma/client';

export interface AdminOrderSummaryOutput {
  id: string;
  orderNumber: string;
  accountId: string;
  storeId: string | null;
  storeName: string | null;
  status: OrderStatus;
  pickupAt: Date;
  buyerName: string;
  buyerPhone: string;
  totalPrice: number;
  createdAt: Date;
  firstItemName: string | null;
  firstItemImageUrl: string | null;
  hasCustom: boolean;
  firstItemCustomImageUrl: string | null;
}

export interface AdminStoreInProgressOrderSummaryOutput {
  storeId: string;
  totalCount: number;
  byStatus: { status: OrderStatus; count: number }[];
}

export interface AdminOrderDetailOutput
  extends OrderAutoTransitionTimes, OrderSettlementFieldsOutput {
  id: string;
  orderNumber: string;
  buyer: {
    accountId: string;
    email: string | null;
    nickname: string | null;
    status: AccountStatus;
  };
  status: OrderStatus;
  pickupAt: Date;
  buyerName: string;
  buyerPhone: string;
  requestNote: string | null;
  payment: AdminOrderPaymentOutput | null;
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
  refunds: OrderRefundOutput[];
  cancellation: OrderCancellationOutput | null;
  cancelOptions: AdminOrderCancelOptionsOutput;
  pickupChanges: OrderPickupChangeOutput[];
  settlementFinalizedAt: Date | null;
  settlementId: string | null;
}

export interface AdminOrderCancelOptionsOutput {
  cancelable: boolean;
  reasons: OrderCancelReason[];
  refundRule: CancelRefundRule | null;
  paidAmount: number;
}
