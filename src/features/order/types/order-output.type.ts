import type { BankOutput } from '@/features/order/types/order-payment-output.type';
import type {
  CustomImageKind,
  CustomMode,
  CustomTextAlign,
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

export interface OrderCustomAreaOutput {
  posX: number;
  posY: number;
  width: number;
  height: number;
}

export interface OrderItemCustomTextOutput extends OrderCustomAreaOutput {
  id: string;
  tokenId: string | null;
  tokenKey: string;
  label: string;
  defaultText: string;
  valueText: string | null;
  textColor: string;
  textAlign: CustomTextAlign;
  sortOrder: number;
}

export interface OrderItemFreeEditAttachmentOutput {
  id: string;
  imageUrl: string;
  sortOrder: number;
}

export interface OrderItemFreeEditOutput extends OrderCustomAreaOutput {
  id: string;
  descriptionText: string;
  sortOrder: number;
  attachments: OrderItemFreeEditAttachmentOutput[];
}

export interface OrderItemCustomImageOutput {
  id: string;
  kind: CustomImageKind;
  imageUrl: string;
}

export interface ThreeDDesignItemOutput {
  kind: 'TEXT' | 'DECO';
  x: number;
  y: number;
  size: number;
  effect: { type: string; intensity: number };
  text: string | null;
  color: string | null;
  decoId: string | null;
}

export interface ThreeDDesignOutput {
  schemaVersion: number;
  basic: {
    shape: string;
    size: string;
    design: string | null;
    flavor: string | null;
    sheetColor: string;
  };
  top: ThreeDDesignItemOutput[];
  side: ThreeDDesignItemOutput[];
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
  customMode: CustomMode;
  customPreviewImageUrl: string | null;
  customBaseImageUrl: string | null;
  customImages: OrderItemCustomImageOutput[];
  threeDDesign: ThreeDDesignOutput | null;
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
