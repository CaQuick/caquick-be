import type { SellerAuditTargetType } from '@/features/audit-log';
import type { StoreOutput } from '@/features/store/types/store-record-output.type';

/** 판매자 SDL(SellerStore)에는 regionId가 없다. */
export type SellerStoreOutput = Omit<StoreOutput, 'regionId'>;

export interface SellerStoreBusinessHourOutput {
  id: string;
  dayOfWeek: number;
  isClosed: boolean;
  openTime: Date | null;
  closeTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerStoreSpecialClosureOutput {
  id: string;
  closureDate: Date;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerStoreDailyCapacityOutput {
  id: string;
  capacityDate: Date;
  capacity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerFaqTopicOutput {
  id: string;
  storeId: string;
  title: string;
  answerHtml: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
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
