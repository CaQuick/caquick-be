import type { AdminRegionRow } from '@/features/admin/repositories/admin.repository';
import type { AdminRegionOutput } from '@/features/admin/types/admin-output.type';

/** 순수 매퍼(DI 없음). */
export function toAdminRegionOutput(row: AdminRegionRow): AdminRegionOutput {
  return {
    id: row.id.toString(),
    parentId: row.parent_id?.toString() ?? null,
    level: row.level,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    centerLat: row.center_lat?.toString() ?? null,
    centerLng: row.center_lng?.toString() ?? null,
    storeCount: row._count.stores,
    childCount: row._count.children,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
