import type {
  OrderItemDetailOutput,
  OrderStatusHistoryOutput,
} from '@/features/order';
import type { SellerAuditTargetType } from '@/features/seller/constants/seller.constants';

export interface SellerCategoryOutput {
  id: string;
  name: string;
}

export interface SellerTagOutput {
  id: string;
  name: string;
}

export interface SellerProductImageOutput {
  id: string;
  imageUrl: string;
  sortOrder: number;
}

export interface SellerOptionItemOutput {
  id: string;
  optionGroupId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  priceDelta: number;
  sortOrder: number;
  isActive: boolean;
}

export interface SellerOptionGroupOutput {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  optionRequiresDescription: boolean;
  optionRequiresImage: boolean;
  sortOrder: number;
  isActive: boolean;
  optionItems: SellerOptionItemOutput[];
}

export interface SellerCustomTextTokenOutput {
  id: string;
  templateId: string;
  tokenKey: string;
  defaultText: string;
  maxLength: number;
  sortOrder: number;
  isRequired: boolean;
  posX: number | null;
  posY: number | null;
  width: number | null;
  height: number | null;
}

export interface SellerCustomTemplateOutput {
  id: string;
  productId: string;
  baseImageUrl: string;
  isActive: boolean;
  textTokens: SellerCustomTextTokenOutput[];
}

export interface SellerProductOutput {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  purchaseNotice: string | null;
  regularPrice: number;
  salePrice: number | null;
  currency: string;
  baseDesignImageUrl: string | null;
  preparationTimeMinutes: number;
  isActive: boolean;
  images: SellerProductImageOutput[];
  categories: SellerCategoryOutput[];
  tags: SellerTagOutput[];
  optionGroups: SellerOptionGroupOutput[];
  customTemplate: SellerCustomTemplateOutput | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerOrderSummaryOutput {
  id: string;
  orderNumber: string;
  status: 'SUBMITTED' | 'CONFIRMED' | 'MADE' | 'PICKED_UP' | 'CANCELED';
  pickupAt: Date;
  buyerName: string;
  buyerPhone: string;
  totalPrice: number;
  createdAt: Date;
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

export interface SellerConversationOutput {
  id: string;
  accountId: string;
  storeId: string;
  lastMessageAt: Date | null;
  lastReadAt: Date | null;
  updatedAt: Date;
}

export interface SellerConversationMessageOutput {
  id: string;
  conversationId: string;
  senderType: 'USER' | 'STORE' | 'SYSTEM';
  senderAccountId: string | null;
  bodyFormat: 'TEXT' | 'HTML';
  bodyText: string | null;
  bodyHtml: string | null;
  createdAt: Date;
}

export interface SellerAuditLogOutput {
  id: string;
  actorAccountId: string;
  storeId: string | null;
  targetType: SellerAuditTargetType;
  targetId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE';
  beforeJson: string | null;
  afterJson: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}
