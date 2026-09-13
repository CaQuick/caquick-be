import type { Banner } from '@prisma/client';

import type { AdminBannerOutput } from '@/features/admin/types/admin-output.type';

/** 순수 매퍼(DI 없음). 저장된 링크 값을 그대로 내린다 — 표시·이동 판단은 linkType 기준. */
export function toAdminBannerOutput(row: Banner): AdminBannerOutput {
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
