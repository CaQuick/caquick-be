import type {
  OrderItemDetailOutput,
  OrderStatusHistoryOutput,
} from '@/features/order';
import type {
  AccountStatus,
  AccountType,
  AuditActionType,
  AuditTargetType,
  OrderStatus,
} from '@/generated/prisma/client';

export interface AdminOrderSummaryOutput {
  id: string;
  orderNumber: string;
  accountId: string;
  storeId: string | null;
  status: OrderStatus;
  pickupAt: Date;
  buyerName: string;
  buyerPhone: string;
  totalPrice: number;
  createdAt: Date;
}

export interface AdminOrderDetailOutput {
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

export interface AdminSendNotificationResultOutput {
  sentCount: number;
  skippedAccountIds: string[];
}

export interface AdminAuditLogOutput {
  id: string;
  actorAccountId: string;
  actorAccountType: AccountType | null;
  storeId: string | null;
  targetType: AuditTargetType;
  targetId: string;
  action: AuditActionType;
  beforeJson: string | null;
  afterJson: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface AdminDashboardSummaryOutput {
  from: Date;
  to: Date;
  newUserCount: number;
  newSellerCount: number;
  orderCounts: {
    submitted: number;
    confirmed: number;
    made: number;
    pickedUp: number;
    canceled: number;
  };
  orderAmountSum: number;
  activeStoreCount: number;
  activeProductCount: number;
  pendingReportCount: number;
}

export interface AdminSearchKeywordSnapshotOutput {
  rankedAt: Date | null;
  items: { rank: number; keyword: string; searchCount: number }[];
}
