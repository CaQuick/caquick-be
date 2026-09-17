import type { OrderStatus } from '@/generated/prisma/client';

/**
 * 주문 품목·상태 이력 공용 출력 타입. SDL(order.types.graphql)의 타입과 필드 일치.
 * 판매자·관리자 주문 상세는 그대로, 구매자 주문 상세는 `MyOrderItem { item, ... }`로 합성한다.
 */

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
