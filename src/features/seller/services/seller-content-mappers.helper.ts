import { Prisma } from '@prisma/client';

import type {
  SellerAuditLogOutput,
  SellerBannerOutput,
  SellerFaqTopicOutput,
} from '@/features/seller/types/seller-output.type';

/**
 * Content 분할 서비스들이 공유하는 매핑 헬퍼.
 *
 * 순수 함수 (this 의존 없음). DI 가 필요 없으므로 static export 만으로 충분.
 */

export interface FaqTopicRow {
  id: bigint;
  store_id: bigint;
  title: string;
  answer_html: string;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface BannerRow {
  id: bigint;
  placement: 'HOME_MAIN' | 'HOME_SUB' | 'CATEGORY' | 'STORE';
  title: string | null;
  image_url: string;
  link_type: 'NONE' | 'URL' | 'PRODUCT' | 'STORE' | 'CATEGORY';
  link_url: string | null;
  link_product_id: bigint | null;
  link_store_id: bigint | null;
  link_category_id: bigint | null;
  starts_at: Date | null;
  ends_at: Date | null;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLogRow {
  id: bigint;
  actor_account_id: bigint;
  store_id: bigint | null;
  target_type:
    | 'STORE'
    | 'PRODUCT'
    | 'ORDER'
    | 'CONVERSATION'
    | 'CHANGE_PASSWORD';
  target_id: bigint;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE';
  before_json: Prisma.JsonValue | null;
  after_json: Prisma.JsonValue | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export function toFaqTopicOutput(row: FaqTopicRow): SellerFaqTopicOutput {
  return {
    id: row.id.toString(),
    storeId: row.store_id.toString(),
    title: row.title,
    answerHtml: row.answer_html,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toBannerOutput(row: BannerRow): SellerBannerOutput {
  return {
    id: row.id.toString(),
    placement: row.placement,
    title: row.title,
    imageUrl: row.image_url,
    linkType: row.link_type,
    linkUrl: row.link_url,
    linkProductId: row.link_product_id?.toString() ?? null,
    linkStoreId: row.link_store_id?.toString() ?? null,
    linkCategoryId: row.link_category_id?.toString() ?? null,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAuditLogOutput(row: AuditLogRow): SellerAuditLogOutput {
  return {
    id: row.id.toString(),
    actorAccountId: row.actor_account_id.toString(),
    storeId: row.store_id?.toString() ?? null,
    targetType: row.target_type,
    targetId: row.target_id.toString(),
    action: row.action,
    beforeJson: row.before_json ? JSON.stringify(row.before_json) : null,
    afterJson: row.after_json ? JSON.stringify(row.after_json) : null,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}
