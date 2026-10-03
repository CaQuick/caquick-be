import type {
  RegionDistrictRow,
  RegionGroupRow,
  RegionRow,
  RegionSearchRow,
} from '@/features/region/repositories/region.repository';
import type {
  RegionByLocationOutput,
  RegionGroupOutput,
  RegionOutput,
  RegionSearchResultOutput,
} from '@/features/region/types/region-output.type';

export function toRegionGroupOutput(row: RegionGroupRow): RegionGroupOutput {
  return {
    id: row.id.toString(),
    name: row.name,
    slug: row.slug,
    hasChildren: row.children.length > 0,
  };
}

export function toRegionOutput(row: RegionRow): RegionOutput {
  return {
    id: row.id.toString(),
    parentId: row.parent_id?.toString() ?? null,
    name: row.name,
    slug: row.slug,
    level: row.level,
  };
}

export function toRegionSearchResultOutput(
  row: RegionSearchRow,
): RegionSearchResultOutput {
  return {
    id: row.id.toString(),
    name: row.name,
    parentName: row.parent?.name ?? null,
    level: row.level,
  };
}

/** 이 2차가 자식이므로 상위 1차의 hasChildren은 항상 true. */
export function toRegionByLocationOutput(
  row: RegionDistrictRow,
): RegionByLocationOutput {
  return {
    group: {
      id: row.parent.id.toString(),
      name: row.parent.name,
      slug: row.parent.slug,
      hasChildren: true,
    },
    region: toRegionOutput(row),
  };
}
