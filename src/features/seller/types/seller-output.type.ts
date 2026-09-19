import type {
  OrderItemDetailOutput,
  OrderStatusHistoryOutput,
} from '@/features/order';
import type { SellerAuditTargetType } from '@/features/seller/constants/seller.constants';

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
