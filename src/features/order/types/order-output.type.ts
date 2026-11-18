import type { BankOutput } from '@/features/order/types/order-payment-output.type';
import type {
  OrderActor,
  OrderCancelFault,
  OrderCancelReason,
  OrderStatus,
  RefundKind,
  RefundStatus,
} from '@/generated/prisma/client';

export interface OrderItemOptionOutput {
  id: string;
  groupName: string;
  optionTitle: string;
  priceDelta: number;
}

export interface OrderItemCustomTextOutput {
  id: string;
  tokenKey: string;
  defaultText: string;
  valueText: string;
  sortOrder: number;
}

export interface OrderItemFreeEditAttachmentOutput {
  id: string;
  imageUrl: string;
  sortOrder: number;
}

export interface OrderItemFreeEditOutput {
  id: string;
  cropImageUrl: string;
  descriptionText: string;
  sortOrder: number;
  attachments: OrderItemFreeEditAttachmentOutput[];
}

export interface OrderItemDetailOutput {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  regularPrice: number;
  salePrice: number | null;
  quantity: number;
  itemSubtotalPrice: number;
  optionItems: OrderItemOptionOutput[];
  customTexts: OrderItemCustomTextOutput[];
  freeEdits: OrderItemFreeEditOutput[];
}

export interface OrderStatusHistoryOutput {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedAt: Date;
  note: string | null;
  actorType: OrderActor;
  cancelReason: OrderCancelReason | null;
  cancelFault: OrderCancelFault | null;
  refundAmount: number | null;
}

export interface OrderCancellationOutput {
  actorType: OrderActor;
  reason: OrderCancelReason;
  reasonLabel: string;
  note: string | null;
  fault: OrderCancelFault | null;
  refundAmount: number;
  refundStatus: RefundStatus | null;
  refundCompletedAt: Date | null;
  canceledAt: Date;
}

export interface OrderRefundOutput {
  id: string;
  kind: RefundKind;
  amount: number;
  status: RefundStatus;
  bank: BankOutput | null;
  accountHolder: string | null;
  accountNumberMasked: string | null;
  requestedAt: Date;
  accountSubmittedAt: Date | null;
  completedAt: Date | null;
}
