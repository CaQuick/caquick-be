import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createRegion } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 지역 중심 좌표 마이그레이션의 SQL을 그대로 실행해 이미 지역이 있는 DB가 시드와 같은 좌표로 채워지는지 본다.
// 마이그레이션은 빈 DB에 적용되므로 여기서만 검증된다.
const ROOT = join(__dirname, '../../../..');
const MIGRATIONS = join(ROOT, 'prisma/migrations');
const MIGRATION_SQL = readFileSync(
  join(
    MIGRATIONS,
    readdirSync(MIGRATIONS).find((d) =>
      d.endsWith('_region_center_coordinates'),
    )!,
    'migration.sql',
  ),
  'utf8',
);
const SEED = (
  JSON.parse(
    readFileSync(join(ROOT, 'prisma/seed/data/regions.generated.json'), 'utf8'),
  ) as { level2: { slug: string; centerLat: string; centerLng: string }[] }
).level2;

function statementOf(sql: string): string {
  const stmts = sql
    .split(';')
    .map((stmt) => stmt.replace(/^\s*--[^\n]*$/gm, '').trim())
    .filter((stmt) => stmt.length > 0);
  expect(stmts).toHaveLength(1);
  return stmts[0];
}

describe('region_center_coordinates 마이그레이션 (real DB)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = await createTestingModuleWithRealDb({ providers: [] }));
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function run(sql = MIGRATION_SQL): Promise<number> {
    return prisma.$executeRawUnsafe(statementOf(sql));
  }

  /** 시드의 2차 지역이 좌표 없이 있는 운영 상태. */
  async function seedWithoutCenters(): Promise<void> {
    for (const { slug } of SEED) await createRegion(prisma, { level: 2, slug });
  }

  /** DB 좌표가 시드와 다른 slug. */
  async function mismatches(): Promise<string[]> {
    const rows = await prisma.region.findMany({
      select: { slug: true, center_lat: true, center_lng: true },
    });
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    return SEED.filter(({ slug, centerLat, centerLng }) => {
      const row = bySlug.get(slug);
      return (
        row?.center_lat?.toFixed(7) !== centerLat ||
        row?.center_lng?.toFixed(7) !== centerLng
      );
    }).map(({ slug }) => slug);
  }

  it('좌표가 없는 2차 지역 83곳을 시드와 같은 좌표로 채운다', async () => {
    expect(SEED).toHaveLength(83);
    await seedWithoutCenters();
    expect(await mismatches()).toHaveLength(83);

    expect(await run()).toBe(83);

    expect(await mismatches()).toEqual([]);
  });

  it('시드와 다른 값이 SQL에 있으면 그 지역만 어긋난다', async () => {
    const [target] = SEED;
    const row = `'${target.slug}' AS \`slug\`, ${target.centerLat}`;
    const mutated = MIGRATION_SQL.replace(
      row,
      `'${target.slug}' AS \`slug\`, 37.0000000`,
    );
    expect(mutated).not.toBe(MIGRATION_SQL);
    await seedWithoutCenters();

    await run(mutated);

    expect(await mismatches()).toEqual([target.slug]);
  });

  it('이미 좌표가 있는 행은 덮어쓰지 않고, 시드에 없는 지역은 비워 둔다', async () => {
    const [manual, empty] = SEED;
    await createRegion(prisma, {
      level: 2,
      slug: manual.slug,
      center_lat: 37.1,
      center_lng: 127.1,
    });
    await createRegion(prisma, { level: 2, slug: empty.slug });
    // 인천 개편으로 말소된 옛 중구
    await createRegion(prisma, { level: 2, slug: 'sgg-28110' });

    expect(await run()).toBe(1);

    const rows = await prisma.region.findMany({
      select: { slug: true, center_lat: true, center_lng: true },
      orderBy: { slug: 'asc' },
    });
    expect(
      rows.map((r) => [
        r.slug,
        r.center_lat?.toFixed(7),
        r.center_lng?.toFixed(7),
      ]),
    ).toEqual([
      [manual.slug, '37.1000000', '127.1000000'],
      [empty.slug, empty.centerLat, empty.centerLng],
      ['sgg-28110', undefined, undefined],
    ]);
  });

  it('지역이 없는 빈 DB에서는 아무 행도 바꾸지 않는다', async () => {
    expect(await run()).toBe(0);
    expect(await prisma.region.count()).toBe(0);
  });
});
