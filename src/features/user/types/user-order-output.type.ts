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
  hasReviewableItem: boolean;
}

export interface MyOrderConnection {
  items: MyOrderSummary[];
  totalCount: number;
  hasMore: boolean;
}

export interface MyOrderStatusHistory {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedAt: Date;
  note: string | null;
}

export interface MyOrderItemSelectedOption {
  groupName: string;
  optionTitle: string;
  priceDelta: number;
}

export interface MyOrderItemCustomText {
  tokenKey: string;
  defaultText: string;
  valueText: string;
  sortOrder: number;
}

export interface MyOrderItemCustomFreeEdit {
  cropImageUrl: string;
  descriptionText: string;
  sortOrder: number;
  attachmentImageUrls: string[];
}

export interface MyOrderItemDetail {
  orderItemId: string;
  productId: string;
  productName: string;
  representativeImageUrl: string | null;
  quantity: number;
  regularPrice: number;
  salePrice: number | null;
  itemSubtotalPrice: number;
  selectedOptions: MyOrderItemSelectedOption[];
  customTexts: MyOrderItemCustomText[];
  customFreeEdits: MyOrderItemCustomFreeEdit[];
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
  statusHistories: MyOrderStatusHistory[];
  items: MyOrderItemDetail[];
  store: MyOrderStoreInfo;
}
