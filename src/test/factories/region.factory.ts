import type { PrismaClient, Region } from '@prisma/client';

import { nextSeq } from '@/test/factories/sequence';

export interface RegionOverrides {
  parent_id?: bigint | null;
  level?: number;
  name?: string;
  slug?: string;
  sort_order?: number;
  is_active?: boolean;
}

export async function createRegion(
  prisma: PrismaClient,
  overrides: RegionOverrides = {},
): Promise<Region> {
  const seq = nextSeq();
  return prisma.region.create({
    data: {
      parent_id: overrides.parent_id ?? null,
      level: overrides.level ?? 1,
      name: overrides.name ?? `Region ${seq}`,
      slug: overrides.slug ?? `region-${seq}`,
      sort_order: overrides.sort_order ?? 0,
      is_active: overrides.is_active ?? true,
    },
  });
}
