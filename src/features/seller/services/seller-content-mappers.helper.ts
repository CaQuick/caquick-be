import {
  SELLER_AUDIT_TARGET_TYPES,
  type SellerAuditTargetType,
} from '@/features/seller/constants/seller.constants';
import type { SellerAuditLogOutput } from '@/features/seller/types/seller-output.type';
import { type AuditTargetType, Prisma } from '@/generated/prisma/client';

export interface AuditLogRow {
  id: bigint;
  actor_account_id: bigint;
  store_id: bigint | null;
  target_type: AuditTargetType;
  target_id: bigint;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE';
  before_json: Prisma.JsonValue | null;
  after_json: Prisma.JsonValue | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export function toAuditLogOutput(row: AuditLogRow): SellerAuditLogOutput {
  return {
    id: row.id.toString(),
    actorAccountId: row.actor_account_id.toString(),
    storeId: row.store_id?.toString() ?? null,
    targetType: toSellerAuditTargetType(row.target_type),
    targetId: row.target_id.toString(),
    action: row.action,
    beforeJson: row.before_json ? JSON.stringify(row.before_json) : null,
    afterJson: row.after_json ? JSON.stringify(row.after_json) : null,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

/** 조회 쿼리가 이미 걸러 주므로 여기 걸리면 repository 필터가 풀린 것이다 — 조용히 넘기지 않고 실패시킨다. */
function toSellerAuditTargetType(raw: AuditTargetType): SellerAuditTargetType {
  if ((SELLER_AUDIT_TARGET_TYPES as readonly string[]).includes(raw)) {
    return raw as SellerAuditTargetType;
  }
  throw new Error(`Unexpected audit target type for seller view: ${raw}`);
}
