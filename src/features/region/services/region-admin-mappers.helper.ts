import type { AdminRegionRow } from '@/features/region/repositories/region-admin.repository';
import type { AdminRegionOutput } from '@/features/region/types/region-admin-output.type';

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
