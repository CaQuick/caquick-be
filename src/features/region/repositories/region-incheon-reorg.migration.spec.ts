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

// 행정안전부 법정동·행정동 코드(2026-09-30) 기준 떨어져 나간 구의 동 전부
const YEONGJONG_DONGS = [
  '중산동',
  '운남동',
  '운서동',
  '운북동',
  '을왕동',
  '남북동',
  '덕교동',
  '무의동',
  '영종동',
  '영종1동',
  '영종2동',
  '운서1동',
  '운서2동',
  '용유동',
];
const GEOMDAN_DONGS = [
  '백석동',
  '마전동',
  '당하동',
  '원당동',
  '대곡동',
  '금곡동',
  '왕길동',
  '불로동',
  '검단동',
  '불로대곡동',
  '아라1동',
  '아라2동',
];
// 아라뱃길 남측 필지가 검암동·경서동(서해구)으로 넘어가 개편 전 이름만으로는 승계 구를 정할 수 없는 동
const AMBIGUOUS_DONGS = ['시천동', '오류동', '오류왕길동'];

type DongKind = 'split' | 'ambiguous' | 'remain' | 'other';
const BLANKS: [string, string | null][] = [
  ['null', null],
  ['빈칸', ''],
  ['공백만', '  '],
];
const OLD_DISTRICTS = {
  [OLD.jung]: {
    name: '중구',
    split: NEW.yeongjong,
    remain: NEW.jemulpo,
    neighborhoods: [
      ['운서동', 'split'],
      [' 운서동 ', 'split'],
      ['신포동', 'remain'],
      ['테스트동', 'other'],
    ] as [string, DongKind][],
    addresses: [
      ['인천 중구 영종대로 85 (운서동)', 'split'],
      ['인천 중구 신포동 1', 'remain'],
      ['인천 중구 공항로 272', 'other'],
    ] as [string, DongKind][],
  },
  [OLD.seo]: {
    name: '서구',
    split: NEW.geomdan,
    remain: NEW.seohae,
    neighborhoods: [
      ['마전동', 'split'],
      [' 원당동 ', 'split'],
      ['시천동', 'ambiguous'],
      ['청라동', 'remain'],
      ['테스트동', 'other'],
    ] as [string, DongKind][],
    addresses: [
      ['인천 서구 마전동 100', 'split'],
      ['인천 서구 오류동 1', 'ambiguous'],
      ['인천 서구 청라동 1', 'remain'],
      ['인천 서구 서곶로 1', 'other'],
    ] as [string, DongKind][],
  },
};

/** 판정 규칙의 기대값. 모호한 동은 옮기지 않고 옛 구에 남는다. */
function expectedSuccessor(oldSlug: string, kind: DongKind): string {
  const district = OLD_DISTRICTS[oldSlug];
  if (kind === 'split') return district.split;
  if (kind === 'ambiguous') return oldSlug;
  return district.remain;
}

const DECISION_TABLE: [string, string, string | null, string, string][] = [
  ...Object.entries(OLD_DISTRICTS).flatMap(([oldSlug, d]) => [
    // 동 칸이 비어 있지 않으면 주소와 상관없이 동 칸으로 정한다
    ...d.neighborhoods.flatMap(([dong, kind]) =>
      d.addresses.map(
        ([address]): [string, string, string | null, string, string] => [
          `${d.name} / 동 칸 '${dong}' / 주소 '${address}'`,
          oldSlug,
          dong,
          address,
          expectedSuccessor(oldSlug, kind),
        ],
      ),
    ),
    // 동 칸이 비었으면 주소로 정한다
    ...BLANKS.flatMap(([blankLabel, blank]) =>
      d.addresses.map(
        ([address, kind]): [string, string, string | null, string, string] => [
          `${d.name} / 동 칸 ${blankLabel} / 주소 '${address}'`,
          oldSlug,
          blank,
          address,
          expectedSuccessor(oldSlug, kind),
        ],
      ),
    ),
  ]),
  // 동구는 전부 제물포구로 갔다
  ...([null, '송림동', '운서동', '마전동'] as (string | null)[]).map(
    (dong): [string, string, string | null, string, string] => [
      `동구 / 동 칸 '${String(dong)}' → 제물포구`,
      OLD.dong,
      dong,
      '인천 동구 운서동 1',
      NEW.jemulpo,
    ],
  ),
];

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

  it.each(YEONGJONG_DONGS)(
    '중구 매장의 동이 %s이면 영종구로 옮긴다',
    async (dong) => {
      const ids = await seedBeforeReorg();
      const store = await createStore(prisma, {
        region_id: ids[OLD.jung],
        address_neighborhood: dong,
        address_full: '인천 중구 공항로 272',
      });

      await runMigration();

      expect(await regionSlugOfStore(store.id)).toBe(NEW.yeongjong);
    },
  );

  it.each(GEOMDAN_DONGS)(
    '서구 매장의 동이 %s이면 검단구로 옮긴다',
    async (dong) => {
      const ids = await seedBeforeReorg();
      const store = await createStore(prisma, {
        region_id: ids[OLD.seo],
        address_neighborhood: dong,
        address_full: '인천 서구 서곶로 1',
      });

      await runMigration();

      expect(await regionSlugOfStore(store.id)).toBe(NEW.geomdan);
    },
  );

  it.each(AMBIGUOUS_DONGS)(
    '서구 매장의 동이 %s이면 옮기지 않고 옛 서구를 비활성으로만 남긴다',
    async (dong) => {
      const ids = await seedBeforeReorg();
      const store = await createStore(prisma, {
        region_id: ids[OLD.seo],
        address_neighborhood: dong,
        address_full: '인천 서구 정서진로 1',
      });

      await runMigration();

      expect(await regionSlugOfStore(store.id)).toBe(OLD.seo);
      const seo = await prisma.region.findUniqueOrThrow({
        where: { slug: OLD.seo },
      });
      expect(seo.is_active).toBe(false);
      expect(seo.deleted_at).toBeNull();
    },
  );

  // 판정 입력 공간 전수: 옛 구 × 동 칸 종류 × 주소 종류. 동 칸이 비어 있지 않으면 동 칸만, 비었을 때만 주소를 본다
  it.each(DECISION_TABLE)(
    '%s',
    async (_label, oldSlug, neighborhood, addressFull, expected) => {
      const ids = await seedBeforeReorg();
      const store = await createStore(prisma, {
        region_id: ids[oldSlug],
        address_full: addressFull,
      });
      await prisma.store.update({
        where: { id: store.id },
        data: { address_neighborhood: neighborhood },
      });

      await runMigration();

      expect(await regionSlugOfStore(store.id)).toBe(expected);
    },
  );

  it.each([
    ['지번 주소', OLD.jung, '인천 중구 운서동 2850-1', NEW.yeongjong],
    [
      '도로명 주소 괄호',
      OLD.jung,
      '인천 중구 영종대로 85 (운서동)',
      NEW.yeongjong,
    ],
    [
      '괄호 안 쉼표 앞',
      OLD.jung,
      '인천 중구 하늘중앙로 1 (중산동, 스카이시티)',
      NEW.yeongjong,
    ],
    ['동 이름이 길 이름의 일부', OLD.jung, '인천 중구 운서동길 3', NEW.jemulpo],
    [
      '확정 동과 모호한 동이 함께 있으면 확정 동',
      OLD.seo,
      '인천 서구 마전동 100 (오류동 인근)',
      NEW.geomdan,
    ],
  ])(
    '동 칸이 비었을 때 주소 형식: %s',
    async (_label, oldSlug, addressFull, expected) => {
      const ids = await seedBeforeReorg();
      const store = await createStore(prisma, {
        region_id: ids[oldSlug],
        address_neighborhood: '',
        address_full: addressFull,
      });

      await runMigration();

      expect(await regionSlugOfStore(store.id)).toBe(expected);
    },
  );

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
