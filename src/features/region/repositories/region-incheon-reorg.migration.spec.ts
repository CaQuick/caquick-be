import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createRegion, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 인천 개편 마이그레이션의 데이터 SQL을 그대로 실행해 이미 지역·매장이 있는 DB가 새 체계로 옮겨지는지 본다.
// 마이그레이션은 빈 DB에 적용되므로 여기서만 검증된다.
const MIGRATIONS = join(__dirname, '../../../../prisma/migrations');
const MIGRATION = join(
  MIGRATIONS,
  readdirSync(MIGRATIONS).find((d) => d.endsWith('_region_incheon_reorg'))!,
  'migration.sql',
);

function statements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(';')
    .map((stmt) => stmt.replace(/^\s*--[^\n]*$/gm, '').trim())
    .filter((stmt) => stmt.length > 0);
}

const OLD = { jung: 'sgg-28110', dong: 'sgg-28140', seo: 'sgg-28260' };
const NEW = {
  jemulpo: 'sgg-28125',
  yeongjong: 'sgg-28155',
  seohae: 'sgg-28275',
  geomdan: 'sgg-28290',
};

describe('region_incheon_reorg 마이그레이션 (real DB)', () => {
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

  async function runMigration(): Promise<void> {
    const stmts = statements();
    expect(stmts).toHaveLength(5);
    for (const stmt of stmts) await prisma.$executeRawUnsafe(stmt);
  }

  /** 개편 전 운영 상태 — 옛 3개 구와 순서가 밀릴 강화군·옹진군. */
  async function seedBeforeReorg(): Promise<Record<string, bigint>> {
    const incheon = await createRegion(prisma, { level: 1, slug: 'incheon' });
    const ids: Record<string, bigint> = { incheon: incheon.id };
    const children: [string, number][] = [
      [OLD.jung, 25],
      [OLD.dong, 26],
      ['sgg-28177', 27],
      [OLD.seo, 32],
      ['sgg-28710', 33],
      ['sgg-28720', 34],
    ];
    for (const [slug, sort] of children) {
      const region = await createRegion(prisma, {
        level: 2,
        parent_id: incheon.id,
        slug,
        sort_order: sort,
      });
      ids[slug] = region.id;
    }
    return ids;
  }

  async function regionSlugOfStore(storeId: bigint): Promise<string | null> {
    const store = await prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { region: { select: { slug: true } } },
    });
    return store.region?.slug ?? null;
  }

  it('신설 4개 구를 인천 아래 활성 2차로 만들고 시드와 같은 순서를 매긴다', async () => {
    const ids = await seedBeforeReorg();

    await runMigration();

    const created = await prisma.region.findMany({
      where: { slug: { in: Object.values(NEW) } },
      orderBy: { sort_order: 'asc' },
      select: {
        slug: true,
        name: true,
        level: true,
        parent_id: true,
        is_active: true,
        sort_order: true,
      },
    });
    expect(created).toEqual([
      {
        slug: NEW.jemulpo,
        name: '제물포구',
        level: 2,
        parent_id: ids.incheon,
        is_active: true,
        sort_order: 25,
      },
      {
        slug: NEW.yeongjong,
        name: '영종구',
        level: 2,
        parent_id: ids.incheon,
        is_active: true,
        sort_order: 26,
      },
      {
        slug: NEW.seohae,
        name: '서해구',
        level: 2,
        parent_id: ids.incheon,
        is_active: true,
        sort_order: 32,
      },
      {
        slug: NEW.geomdan,
        name: '검단구',
        level: 2,
        parent_id: ids.incheon,
        is_active: true,
        sort_order: 33,
      },
    ]);
  });

  it('밀린 인천 2차(강화군·옹진군)의 순서를 새 시드 값으로 맞추고 나머지는 그대로 둔다', async () => {
    await seedBeforeReorg();

    await runMigration();

    const rows = await prisma.region.findMany({
      where: { slug: { in: ['sgg-28177', 'sgg-28710', 'sgg-28720'] } },
      orderBy: { slug: 'asc' },
      select: { slug: true, sort_order: true },
    });
    expect(rows).toEqual([
      { slug: 'sgg-28177', sort_order: 27 },
      { slug: 'sgg-28710', sort_order: 34 },
      { slug: 'sgg-28720', sort_order: 35 },
    ]);
  });

  // 동 칸이 비어 있지 않으면 동 칸만, 비었을 때만 주소를 본다
  it.each([
    ['동구는 전부 제물포구', OLD.dong, '송림동', '', NEW.jemulpo],
    ['중구 영종 동', OLD.jung, '운서동', '', NEW.yeongjong],
    ['중구 나머지 동', OLD.jung, '신포동', '', NEW.jemulpo],
    ['서구 검단 동', OLD.seo, '마전동', '', NEW.geomdan],
    ['서구 나머지 동', OLD.seo, '청라동', '', NEW.seohae],
    [
      '동 칸이 비면 주소(괄호 표기)',
      OLD.jung,
      '',
      '인천 중구 영종대로 85 (운서동)',
      NEW.yeongjong,
    ],
    [
      '동 칸이 주소보다 우선',
      OLD.jung,
      '신포동',
      '인천 중구 운서동 1',
      NEW.jemulpo,
    ],
  ])('%s', async (_label, oldSlug, dong, addressFull, expected) => {
    const ids = await seedBeforeReorg();
    const store = await createStore(prisma, {
      region_id: ids[oldSlug],
      address_neighborhood: dong,
      address_full: addressFull,
    });

    await runMigration();

    expect(await regionSlugOfStore(store.id)).toBe(expected);
  });

  it('서구 시천동·오류동처럼 승계 구가 모호하면 옮기지 않고 옛 서구를 비활성으로만 남긴다', async () => {
    const ids = await seedBeforeReorg();
    const store = await createStore(prisma, {
      region_id: ids[OLD.seo],
      address_neighborhood: '시천동',
    });

    await runMigration();

    expect(await regionSlugOfStore(store.id)).toBe(OLD.seo);
    const seo = await prisma.region.findUniqueOrThrow({
      where: { slug: OLD.seo },
    });
    expect(seo.is_active).toBe(false);
    expect(seo.deleted_at).toBeNull();
  });

  it('삭제된 매장도 옮긴다', async () => {
    const ids = await seedBeforeReorg();
    const store = await createStore(prisma, {
      region_id: ids[OLD.dong],
      deleted_at: new Date('2026-09-01T00:00:00.000Z'),
    });

    await runMigration();

    expect(await regionSlugOfStore(store.id)).toBe(NEW.jemulpo);
  });

  it('다른 지역 매장과 지역이 없는 매장은 건드리지 않는다', async () => {
    const ids = await seedBeforeReorg();
    const other = await createStore(prisma, { region_id: ids['sgg-28177'] });
    const none = await createStore(prisma, { region_id: null });

    await runMigration();

    expect(await regionSlugOfStore(other.id)).toBe('sgg-28177');
    expect(await regionSlugOfStore(none.id)).toBeNull();
  });

  it('옛 3개 구를 비활성·삭제 처리한다', async () => {
    const ids = await seedBeforeReorg();
    await createStore(prisma, { region_id: ids[OLD.jung] });

    await runMigration();

    for (const slug of Object.values(OLD)) {
      const region = await prisma.region.findUniqueOrThrow({ where: { slug } });
      expect(region.is_active).toBe(false);
      expect(region.deleted_at).not.toBeNull();
    }
  });

  it("상위 'incheon'이 없으면 아무것도 만들거나 옮기거나 내리지 않는다", async () => {
    const orphan = await createRegion(prisma, { level: 2, slug: OLD.jung });
    const store = await createStore(prisma, { region_id: orphan.id });
    await createRegion(prisma, { level: 2, slug: OLD.dong });

    await runMigration();

    expect(
      await prisma.region.count({
        where: { slug: { in: Object.values(NEW) } },
      }),
    ).toBe(0);
    expect(await regionSlugOfStore(store.id)).toBe(OLD.jung);
    for (const slug of [OLD.jung, OLD.dong]) {
      const kept = await prisma.region.findUniqueOrThrow({ where: { slug } });
      expect(kept.is_active).toBe(true);
      expect(kept.deleted_at).toBeNull();
    }
  });

  it('두 번 실행해도 결과가 같다', async () => {
    const ids = await seedBeforeReorg();
    const store = await createStore(prisma, {
      region_id: ids[OLD.jung],
      address_neighborhood: '운서동',
    });

    await runMigration();
    const snapshot = await prisma.region.findMany({
      orderBy: { slug: 'asc' },
      select: {
        slug: true,
        parent_id: true,
        sort_order: true,
        is_active: true,
      },
    });
    await runMigration();

    expect(
      await prisma.region.findMany({
        orderBy: { slug: 'asc' },
        select: {
          slug: true,
          parent_id: true,
          sort_order: true,
          is_active: true,
        },
      }),
    ).toEqual(snapshot);
    expect(await regionSlugOfStore(store.id)).toBe(NEW.yeongjong);
  });
});
