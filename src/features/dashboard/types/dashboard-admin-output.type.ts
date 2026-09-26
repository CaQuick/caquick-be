import type {
  AccountType,
  AuditActionType,
  AuditTargetType,
} from '@/generated/prisma/client';

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
