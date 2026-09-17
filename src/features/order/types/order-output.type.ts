import type { OrderStatus } from '@/generated/prisma/client';

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
}
