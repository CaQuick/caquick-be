/**
 * 지역(Region) 마스터 시드.
 *
 * 입력: prisma/seed/data/regions.generated.json (scripts/generate-region-seed.ts 산출물)
 * - 1차 광역그룹 → 2차 시군구 순으로 slug 기준 upsert (멱등).
 * - 지역은 영구 마스터이므로 resetSeedScope 정리 대상이 아니다. 항상 최신 상태로 보정한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@prisma/client';

interface RegionSeedFile {
  level1: { slug: string; name: string; sortOrder: number }[];
  level2: {
    slug: string;
    name: string;
    parentSlug: string;
    sigunguCode: string;
    sortOrder: number;
  }[];
}

export async function seedRegions(prisma: PrismaClient): Promise<void> {
  const filePath = join(
    process.cwd(),
    'prisma/seed/data/regions.generated.json',
  );
  const data = JSON.parse(readFileSync(filePath, 'utf8')) as RegionSeedFile;

  const slugToId = new Map<string, bigint>();
  for (const group of data.level1) {
    const region = await prisma.region.upsert({
      where: { slug: group.slug },
      create: {
        level: 1,
        name: group.name,
        slug: group.slug,
        sort_order: group.sortOrder,
      },
      update: {
        level: 1,
        parent_id: null,
        name: group.name,
        sort_order: group.sortOrder,
        is_active: true,
        deleted_at: null,
      },
    });
    slugToId.set(group.slug, region.id);
  }

  for (const child of data.level2) {
    const parentId = slugToId.get(child.parentSlug);
    if (parentId === undefined) {
      throw new Error(
        `[seed] region parent not found: ${child.parentSlug} (child ${child.slug})`,
      );
    }
    await prisma.region.upsert({
      where: { slug: child.slug },
      create: {
        level: 2,
        name: child.name,
        slug: child.slug,
        sort_order: child.sortOrder,
        parent_id: parentId,
      },
      update: {
        level: 2,
        name: child.name,
        sort_order: child.sortOrder,
        parent_id: parentId,
        is_active: true,
        deleted_at: null,
      },
    });
  }
}
